import { lookup } from "node:dns/promises";
import {
  request as httpRequest,
  type IncomingMessage,
  type RequestOptions,
} from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { pipeline, type Readable, type Transform } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";

import {
  type AsyncResult,
  err,
  ok,
  type Result,
} from "@workspace/shared/result";

import { isPublicAddress } from "./address";

// The link-preview fetcher (101): the one place the server requests a URL a
// user or a model supplied, so it's built against SSRF.
//
// - http(s) only, no credentials in the URL, default ports only.
// - Every hop resolves its name once (all answers), and every answer must be
//   a public address (`isPublicAddress`); otherwise the request is refused
//   before a socket opens.
// - The socket connects to the address that was checked: the HTTP client's
//   own lookup is replaced by one that returns it. A name that rebinds
//   between the check and the connection can't move it. (TLS still verifies
//   the certificate against the name.)
// - Redirects are followed by hand, at most `maxRedirects`, each hop checked
//   as above.
// - One deadline covers the whole exchange; bodies are capped after decoding
//   (so a gzip bomb stops at the cap), and only the content types the policy
//   accepts are read at all.
//
// `allowOrigins` is a TEST-ONLY escape hatch (see `test-allowlist.ts`): an
// exact origin listed there skips the address-range check. Nothing in
// app.config.yaml can set it.

export interface ResolvedAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

/** Every address a name resolves to. A port, so tests never touch real DNS. */
export type Resolve = (hostname: string) => Promise<readonly ResolvedAddress[]>;

export const systemResolve: Resolve = async (hostname) => {
  const answers = await lookup(hostname, { all: true, verbatim: true });
  return answers.map(({ address, family }) => ({
    address,
    family: family === 6 ? 6 : 4,
  }));
};

export interface FetchPolicy {
  /** Whether to read a response of this (lowercase, parameter-free) type. */
  readonly accept: (contentType: string) => boolean;
  readonly acceptHeader: string;
  readonly maxBytes: number;
  /** Past `maxBytes`: keep what was read (HTML) or fail (images). */
  readonly overflow: "refuse" | "truncate";
  /** Stop reading once the body so far contains this (case-insensitive). */
  readonly stopAt?: string;
}

export interface SafeFetchDeps {
  /** TEST ONLY: exact origins whose addresses aren't range-checked. */
  readonly allowOrigins: ReadonlySet<string>;
  readonly maxRedirects?: number;
  readonly resolve: Resolve;
  /** For the whole exchange, redirects and body included. */
  readonly timeoutMs?: number;
}

export type FetchFailure =
  | { readonly reason: string; readonly type: "blocked" }
  | { readonly contentType: string; readonly type: "unsupported_type" }
  | { readonly message: string; readonly type: "network" }
  | { readonly status: number; readonly type: "http_status" }
  | { readonly type: "timeout" }
  | { readonly type: "too_large" }
  | { readonly type: "too_many_redirects" };

export interface Fetched {
  readonly body: Uint8Array<ArrayBuffer>;
  /** The `charset` parameter, when the response named one. */
  readonly charset: string | null;
  /** Lowercase, without parameters. */
  readonly contentType: string;
  readonly finalUrl: URL;
  /** Whether the body was cut at `maxBytes`. */
  readonly truncated: boolean;
}

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_REDIRECTS = 3;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

// A browser-like UA: some sites refuse anything else. Never the product name.
const USER_AGENT =
  "Mozilla/5.0 (compatible; LinkPreview/1.0; +https://ogp.me/)";

const blocked = (reason: string) =>
  err<FetchFailure>({ reason, type: "blocked" });

const BRACKETS = /^\[|\]$/g;
const QUOTES = /^"|"$/g;

const bareHost = (url: URL) => url.hostname.replace(BRACKETS, "");

/** The checks that need no DNS. */
const checkUrl = (url: URL, allowed: boolean): string | null => {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return `the ${url.protocol} scheme isn't fetched`;
  }
  if (url.username || url.password) {
    return "URLs with credentials aren't fetched";
  }
  if (url.port !== "" && !allowed) {
    return "only default ports are fetched";
  }
  return null;
};

type Pinned =
  | { readonly address: ResolvedAddress; readonly ok: true }
  | { readonly failure: FetchFailure; readonly ok: false };

/** One lookup per hop; every answer must pass, and the first is used. */
const pin = async (
  url: URL,
  allowed: boolean,
  resolve: Resolve
): Promise<Pinned> => {
  const host = bareHost(url);
  const family = isIP(host);
  let answers: readonly ResolvedAddress[];
  if (family === 4 || family === 6) {
    answers = [{ address: host, family }];
  } else {
    try {
      answers = await resolve(host);
    } catch (cause) {
      return {
        failure: {
          message: cause instanceof Error ? cause.message : "lookup failed",
          type: "network",
        },
        ok: false,
      };
    }
  }
  const first = answers.at(0);
  if (!first) {
    return {
      failure: { message: "the name has no addresses", type: "network" },
      ok: false,
    };
  }
  if (!(allowed || answers.every(({ address }) => isPublicAddress(address)))) {
    return {
      failure: {
        reason: "the address is on a private or reserved network",
        type: "blocked",
      },
      ok: false,
    };
  }
  return { address: first, ok: true };
};

/** The HTTP client's lookup, answering with the checked address only. */
const pinnedLookup =
  ({ address, family }: ResolvedAddress): LookupFunction =>
  (_hostname, options, callback) => {
    if (options.all) {
      callback(null, [{ address, family }]);
      return;
    }
    callback(null, address, family);
  };

const send = (
  url: URL,
  address: ResolvedAddress,
  policy: FetchPolicy,
  signal: AbortSignal
): Promise<IncomingMessage> =>
  new Promise((resolve, reject) => {
    const options: RequestOptions = {
      // A fresh socket per request: a pooled one could have been opened for
      // an earlier answer.
      agent: false,
      headers: {
        accept: policy.acceptHeader,
        "accept-encoding": "gzip, deflate, br",
        "accept-language": "en;q=0.9, *;q=0.5",
        "user-agent": USER_AGENT,
      },
      hostname: bareHost(url),
      lookup: pinnedLookup(address),
      method: "GET",
      path: `${url.pathname}${url.search}`,
      port: url.port || undefined,
      signal,
    };
    const request =
      url.protocol === "https:"
        ? httpsRequest(options, resolve)
        : httpRequest(options, resolve);
    request.on("error", reject);
    request.end();
  });

const DECODERS: Readonly<Record<string, () => Transform>> = {
  br: createBrotliDecompress,
  deflate: createInflate,
  gzip: createGunzip,
  "x-gzip": createGunzip,
};

const decoded = (response: IncomingMessage): Readable => {
  const encoding = (response.headers["content-encoding"] ?? "")
    .trim()
    .toLowerCase();
  const create = DECODERS[encoding];
  if (!create) {
    return response;
  }
  const decoder = create();
  return pipeline(response, decoder, () => {
    // Errors surface through the decoder's iteration.
  });
};

const indexOfIgnoringCase = (chunks: string, needle: string) =>
  chunks.toLowerCase().indexOf(needle);

type Body =
  | {
      readonly body: Uint8Array<ArrayBuffer>;
      readonly ok: true;
      readonly truncated: boolean;
    }
  | { readonly ok: false };

/** Reads up to the cap (and the stop marker), then lets the socket go. */
const readBody = async (
  response: IncomingMessage,
  policy: FetchPolicy
): Promise<Body> => {
  const stream = decoded(response);
  const chunks: Buffer[] = [];
  let size = 0;
  let truncated = false;
  // A latin1 view of the tail is enough to find an ASCII marker.
  let tail = "";
  const stopAt = policy.stopAt?.toLowerCase();
  try {
    for await (const raw of stream) {
      const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as string);
      const room = policy.maxBytes - size;
      if (chunk.byteLength > room) {
        if (policy.overflow === "refuse") {
          return { ok: false };
        }
        chunks.push(chunk.subarray(0, room));
        size += room;
        truncated = true;
        break;
      }
      chunks.push(chunk);
      size += chunk.byteLength;
      if (stopAt) {
        tail = (tail + chunk.toString("latin1")).slice(
          -(chunk.byteLength + stopAt.length)
        );
        if (indexOfIgnoringCase(tail, stopAt) !== -1) {
          break;
        }
      }
    }
  } finally {
    stream.destroy();
    response.destroy();
  }
  return { body: new Uint8Array(Buffer.concat(chunks)), ok: true, truncated };
};

const contentTypeOf = (response: IncomingMessage) => {
  const header = response.headers["content-type"] ?? "";
  const [type = "", ...params] = header.split(";");
  const charset = params
    .map((param) => param.trim().split("="))
    .find(([key]) => key?.toLowerCase() === "charset")?.[1];
  return {
    charset: charset ? charset.replace(QUOTES, "").trim() : null,
    type: type.trim().toLowerCase(),
  };
};

const isAbort = (cause: unknown) =>
  cause instanceof Error &&
  (cause.name === "AbortError" ||
    ("code" in cause && cause.code === "ABORT_ERR"));

type Hop =
  | { readonly next: URL; readonly type: "redirect" }
  | { readonly result: Result<Fetched, FetchFailure>; readonly type: "done" };

/** One request: checked, pinned, and either a redirect or the answer. */
const fetchHop = async (
  url: URL,
  policy: FetchPolicy,
  deps: SafeFetchDeps,
  signal: AbortSignal
): Promise<Hop> => {
  const done = (result: Result<Fetched, FetchFailure>): Hop => ({
    result,
    type: "done",
  });
  const allowed = deps.allowOrigins.has(url.origin);
  const problem = checkUrl(url, allowed);
  if (problem) {
    return done(blocked(problem));
  }
  const pinned = await pin(url, allowed, deps.resolve);
  if (!pinned.ok) {
    return done(err(pinned.failure));
  }
  const response = await send(url, pinned.address, policy, signal);
  const status = response.statusCode ?? 0;
  const { location } = response.headers;
  if (REDIRECTS.has(status) && location) {
    response.destroy();
    try {
      return { next: new URL(location, url), type: "redirect" };
    } catch {
      return done(blocked("the redirect isn't a URL"));
    }
  }
  const refusal = refuse(response, status, policy);
  if (refusal) {
    response.destroy();
    return done(err(refusal));
  }
  const { charset, type } = contentTypeOf(response);
  const read = await readBody(response, policy);
  return done(
    read.ok
      ? ok({
          body: read.body,
          charset,
          contentType: type,
          finalUrl: url,
          truncated: read.truncated,
        })
      : err({ type: "too_large" })
  );
};

/** Why not to read this response's body, if there's a reason. */
const refuse = (
  response: IncomingMessage,
  status: number,
  policy: FetchPolicy
): FetchFailure | null => {
  if (status < 200 || status > 299) {
    return { status, type: "http_status" };
  }
  const { type } = contentTypeOf(response);
  if (!policy.accept(type)) {
    return { contentType: type, type: "unsupported_type" };
  }
  const declared = Number(response.headers["content-length"]);
  const encoded = Boolean(response.headers["content-encoding"]);
  if (
    policy.overflow === "refuse" &&
    !encoded &&
    Number.isFinite(declared) &&
    declared > policy.maxBytes
  ) {
    return { type: "too_large" };
  }
  return null;
};

/** GETs `input` under `policy`, refusing anything off the open internet. */
export const safeFetch = async (
  input: string | URL,
  policy: FetchPolicy,
  deps: SafeFetchDeps
): AsyncResult<Fetched, FetchFailure> => {
  const maxRedirects = deps.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    deps.timeoutMs ?? DEFAULT_TIMEOUT_MS
  );
  try {
    let url = URL.parse(input);
    if (!url) {
      return blocked("not a URL");
    }
    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      // biome-ignore lint/performance/noAwaitInLoops: each redirect hop depends on the last
      const step = await fetchHop(url, policy, deps, controller.signal);
      if (step.type === "done") {
        return step.result;
      }
      url = step.next;
    }
    return err({ type: "too_many_redirects" });
  } catch (cause) {
    if (controller.signal.aborted || isAbort(cause)) {
      return err({ type: "timeout" });
    }
    return err({
      message: cause instanceof Error ? cause.message : "request failed",
      type: "network",
    });
  } finally {
    clearTimeout(timer);
  }
};
