import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";

import {
  type AsyncResult,
  err,
  ok,
  type Result,
} from "@workspace/shared/result";
import { z } from "zod";

import {
  type SignedUrlOptions,
  type Storage,
  type StorageBody,
  type StorageError,
  type StoredObject,
  storageKeySchema,
  storedObjectSchema,
} from "../ports/storage";

// The local-volume Storage adapter (D24, the compose default): objects are
// files under `<root>/objects/<key>`, each with a JSON sidecar under
// `<root>/meta/` holding its content type and etag. Writes land in
// `<root>/tmp/` and are renamed into place, so a reader never sees half an
// object. Signed URLs point at our own route (mounted by the server at
// `baseUrl`), which checks them with `verifyLocalSignature`.

export interface LocalStorageOptions {
  /** Where signed URLs point: the route that serves and accepts objects, e.g. `https://chat.example.com/api/storage`. */
  readonly baseUrl: string;
  readonly now?: () => Date;
  /** The volume path (`storage.path`). */
  readonly root: string;
  /** Signs URLs; the serving route verifies with the same one. */
  readonly signingSecret: string;
}

const metaSchema = storedObjectSchema.omit({ key: true });

const unavailable = (cause: unknown): StorageError => ({
  message: `local storage failed${cause instanceof Error && "code" in cause ? `: ${String(cause.code)}` : ""}`,
  type: "unavailable",
});

const isMissing = (cause: unknown): boolean =>
  cause instanceof Error && "code" in cause && cause.code === "ENOENT";

/** Percent-encodes each path segment, keeping the slashes. */
export const encodeKey = (key: string): string =>
  key.split("/").map(encodeURIComponent).join("/");

const signaturePayload = ({
  contentType,
  expires,
  key,
  method,
}: {
  readonly contentType: string;
  readonly expires: number;
  readonly key: string;
  readonly method: string;
}) => [method, key, String(expires), contentType].join("\n");

const sign = (secret: string, payload: string) =>
  createHmac("sha256", secret).update(payload).digest("base64url");

export const signedRequestSchema = z.object({
  /** For PUT: the content type the upload must carry; empty otherwise. */
  contentType: z.string().default(""),
  /** Unix seconds. */
  expires: z.coerce.number().int(),
  key: storageKeySchema,
  method: z.enum(["GET", "PUT"]),
  signature: z.string().min(1),
});
export type SignedRequest = z.input<typeof signedRequestSchema>;

export type SignatureError = "expired" | "invalid";

/**
 * Checks a request against a local signed URL: the route calls this with
 * the key from the path, the query parameters and the request method.
 */
export const verifyLocalSignature = (
  request: SignedRequest,
  secret: string,
  now: Date = new Date()
): Result<z.infer<typeof signedRequestSchema>, SignatureError> => {
  const parsed = signedRequestSchema.safeParse(request);
  if (!parsed.success) {
    return err("invalid");
  }
  const expected = Buffer.from(sign(secret, signaturePayload(parsed.data)));
  const given = Buffer.from(parsed.data.signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return err("invalid");
  }
  return parsed.data.expires * 1000 < now.getTime()
    ? err("expired")
    : ok(parsed.data);
};

/** Writes a body to `path`, returning its size and SHA-256, without holding it all in memory. */
const writeBody = async (
  path: string,
  body: StorageBody
): Promise<{ readonly sha256: string; readonly size: number }> => {
  const hash = createHash("sha256");
  const handle = await open(path, "w");
  let size = 0;
  try {
    if (body instanceof Uint8Array) {
      hash.update(body);
      await handle.write(body);
      size = body.length;
    } else {
      const reader = body.getReader();
      for (;;) {
        // biome-ignore lint/performance/noAwaitInLoops: a stream is read chunk by chunk.
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        hash.update(value);
        await handle.write(value);
        size += value.length;
      }
    }
  } finally {
    await handle.close();
  }
  return { sha256: hash.digest("hex"), size };
};

export const createLocalStorage = ({
  baseUrl,
  now = () => new Date(),
  root,
  signingSecret,
}: LocalStorageOptions): Storage => {
  const base = resolve(root);
  const objects = join(base, "objects");
  const meta = join(base, "meta");
  const tmp = join(base, "tmp");

  /** The key's paths, or `null` if it isn't a valid key or would escape the root. */
  const pathsOf = (key: string) => {
    if (!storageKeySchema.safeParse(key).success) {
      return null;
    }
    const object = resolve(objects, key);
    return object.startsWith(`${objects}${sep}`)
      ? { meta: resolve(meta, `${key}.json`), object }
      : null;
  };

  const readMeta = async (
    key: string,
    path: string
  ): AsyncResult<StoredObject, StorageError> => {
    try {
      const parsed = metaSchema.safeParse(
        JSON.parse(await readFile(path, "utf8"))
      );
      return parsed.success
        ? ok({ ...parsed.data, key })
        : err({ key, type: "not_found" });
    } catch (cause) {
      return isMissing(cause)
        ? err({ key, type: "not_found" })
        : err(unavailable(cause));
    }
  };

  return {
    delete: async (key) => {
      const paths = pathsOf(key);
      if (!paths) {
        return err({ key, type: "invalid_key" });
      }
      try {
        await rm(paths.object, { force: true });
        await rm(paths.meta, { force: true });
        return ok(undefined);
      } catch (cause) {
        return err(unavailable(cause));
      }
    },

    get: async (key) => {
      const paths = pathsOf(key);
      if (!paths) {
        return err({ key, type: "invalid_key" });
      }
      const object = await readMeta(key, paths.meta);
      if (!object.ok) {
        return object;
      }
      try {
        // Opening first turns a missing file into a result, not a stream error.
        const handle = await open(paths.object, "r");
        const stream = createReadStream("", { autoClose: true, fd: handle });
        return ok({
          body: Readable.toWeb(stream) as ReadableStream<Uint8Array>,
          object: object.value,
        });
      } catch (cause) {
        return isMissing(cause)
          ? err({ key, type: "not_found" })
          : err(unavailable(cause));
      }
    },

    put: async (key, body, { contentType }) => {
      const paths = pathsOf(key);
      if (!paths) {
        return err({ key, type: "invalid_key" });
      }
      const staging = join(tmp, randomUUID());
      try {
        await mkdir(tmp, { recursive: true });
        const { sha256, size } = await writeBody(staging, body);
        const object: StoredObject = {
          contentType,
          etag: `"${sha256}"`,
          key,
          size,
          updatedAt: now().toISOString(),
        };
        await mkdir(dirname(paths.object), { recursive: true });
        await mkdir(dirname(paths.meta), { recursive: true });
        await rename(staging, paths.object);
        const { key: _key, ...sidecar } = object;
        await writeFile(paths.meta, JSON.stringify(sidecar));
        return ok(object);
      } catch (cause) {
        await rm(staging, { force: true });
        return err(unavailable(cause));
      }
    },

    signedUrl: async (
      key,
      { contentType, expiresInSeconds, method }: SignedUrlOptions
    ) => {
      const paths = pathsOf(key);
      if (!paths) {
        return err({ key, type: "invalid_key" });
      }
      if (method === "GET") {
        const exists = await readMeta(key, paths.meta);
        if (!exists.ok) {
          return exists;
        }
      }
      const expires = Math.floor(now().getTime() / 1000) + expiresInSeconds;
      const pinned = method === "PUT" ? (contentType ?? "") : "";
      const query = new URLSearchParams({
        expires: String(expires),
        method,
        ...(pinned ? { contentType: pinned } : {}),
        signature: sign(
          signingSecret,
          signaturePayload({ contentType: pinned, expires, key, method })
        ),
      });
      const route = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
      return ok({
        expiresAt: new Date(expires * 1000).toISOString(),
        url: `${route}/${encodeKey(key)}?${query}`,
      });
    },

    stat: (key) => {
      const paths = pathsOf(key);
      return paths
        ? readMeta(key, paths.meta)
        : Promise.resolve(err({ key, type: "invalid_key" as const }));
    },
  };
};
