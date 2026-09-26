import { err, ok, type Result } from "@workspace/shared/result";

// Request signing for the runner's internal API (D7, D24). `web` and the
// runner share a secret (`SANDBOX_RUNNER_TOKEN`); every request carries an
// HMAC-SHA256 over its timestamp, method, path and body hash, so a request
// can't be forged, altered or replayed outside a short window. The secret
// itself never crosses the wire. WebCrypto only: runs on Node, Bun and edge.

export const TIMESTAMP_HEADER = "x-runner-timestamp";
export const SIGNATURE_HEADER = "x-runner-signature";

/** How far a request's clock may be from ours. */
export const MAX_SKEW_SECONDS = 300;

const encoder = new TextEncoder();
const DIGITS = /^\d+$/;

const hex = (buffer: ArrayBuffer): string =>
  [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

const sha256 = async (body: Uint8Array | string): Promise<string> =>
  hex(
    await crypto.subtle.digest(
      "SHA-256",
      // A copy, so the digest gets a plain ArrayBuffer-backed view.
      typeof body === "string" ? encoder.encode(body) : new Uint8Array(body)
    )
  );

const hmac = async (secret: string, message: string): Promise<string> => {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"]
  );
  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
};

export interface SignableRequest {
  readonly body: Uint8Array | string;
  readonly method: string;
  /** Path plus query string, exactly as sent. */
  readonly path: string;
}

const canonical = async (
  request: SignableRequest,
  timestamp: string
): Promise<string> =>
  [
    timestamp,
    request.method.toUpperCase(),
    request.path,
    await sha256(request.body),
  ].join("\n");

/** Headers that authenticate `request` with `secret` at time `now`. */
export const signRequest = async (
  secret: string,
  request: SignableRequest,
  now = new Date()
): Promise<Record<string, string>> => {
  const timestamp = Math.floor(now.getTime() / 1000).toString();
  return {
    [SIGNATURE_HEADER]: await hmac(secret, await canonical(request, timestamp)),
    [TIMESTAMP_HEADER]: timestamp,
  };
};

export type VerifyError = "missing" | "expired" | "invalid";

/** Compares in constant time, so the signature can't be guessed byte by byte. */
const equal = (a: string, b: string): boolean => {
  if (a.length !== b.length) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference += a.charCodeAt(index) === b.charCodeAt(index) ? 0 : 1;
  }
  return difference === 0;
};

export const verifyRequest = async (
  secret: string,
  request: SignableRequest & {
    readonly signature: string | undefined;
    readonly timestamp: string | undefined;
  },
  now = new Date()
): Promise<Result<void, VerifyError>> => {
  const { signature, timestamp } = request;
  if (!(signature && timestamp && DIGITS.test(timestamp))) {
    return err("missing");
  }
  const skew = Math.abs(now.getTime() / 1000 - Number(timestamp));
  if (skew > MAX_SKEW_SECONDS) {
    return err("expired");
  }
  const expected = await hmac(secret, await canonical(request, timestamp));
  return equal(expected, signature.toLowerCase())
    ? ok(undefined)
    : err("invalid");
};
