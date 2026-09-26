import { type AsyncResult, err, ok } from "@workspace/shared/result";
import { AwsClient } from "aws4fetch";

import {
  type Storage,
  type StorageError,
  type StoredObject,
  storageKeySchema,
} from "../ports/storage";
import { encodeKey } from "./local";

// The S3-compatible Storage adapter (D24): AWS S3, Cloudflare R2, MinIO,
// Garage and friends, over plain HTTP signed with SigV4 by aws4fetch (a
// few kilobytes, MIT) rather than the AWS SDK, since five calls don't need
// a megabyte of client. Presigned URLs let clients download (and, later,
// upload) directly from the bucket.

export type FetchFunction = typeof globalThis.fetch;

export interface S3StorageOptions {
  readonly accessKeyId: string;
  readonly bucket: string;
  /** `https://<account>.r2.cloudflarestorage.com`, `http://minio:9000`; `null` for AWS itself. */
  readonly endpoint: string | null;
  readonly fetch?: FetchFunction;
  /** Path-style URLs (`endpoint/bucket/key`), which MinIO needs. */
  readonly forcePathStyle: boolean;
  readonly now?: () => Date;
  /** `auto` for R2. */
  readonly region: string;
  readonly secretAccessKey: string;
}

/** SigV4's timestamp format: `20260927T010203Z`. */
const MILLISECONDS = /\.\d{3}/;
const amzDate = (date: Date) =>
  date.toISOString().replaceAll(/[-:]/g, "").replace(MILLISECONDS, "");

const unavailable = (message: string): StorageError => ({
  message,
  type: "unavailable",
});

export const createS3Storage = ({
  accessKeyId,
  bucket,
  endpoint,
  fetch = globalThis.fetch,
  forcePathStyle,
  now = () => new Date(),
  region,
  secretAccessKey,
}: S3StorageOptions): Storage => {
  const client = new AwsClient({
    accessKeyId,
    region,
    retries: 0,
    secretAccessKey,
    service: "s3",
  });
  const base = new URL(endpoint ?? `https://s3.${region}.amazonaws.com`);
  const { origin } = base;

  const urlOf = (key: string): string =>
    forcePathStyle
      ? `${origin}/${encodeURIComponent(bucket)}/${encodeKey(key)}`
      : `${base.protocol}//${bucket}.${base.host}/${encodeKey(key)}`;

  const invalid = (key: string) => !storageKeySchema.safeParse(key).success;

  const send = async (
    key: string,
    init: RequestInit
  ): AsyncResult<Response, StorageError> => {
    try {
      const request = await client.sign(urlOf(key), {
        ...init,
        aws: { datetime: amzDate(now()) },
      });
      return ok(await fetch(request));
    } catch {
      return err(unavailable("the object store couldn't be reached"));
    }
  };

  const failed = (key: string, response: Response): StorageError =>
    response.status === 404
      ? { key, type: "not_found" }
      : unavailable(`the object store answered ${response.status}`);

  const objectOf = (key: string, response: Response): StoredObject => {
    const modified = response.headers.get("last-modified");
    const updatedAt = modified ? new Date(modified) : now();
    return {
      contentType:
        response.headers.get("content-type") ?? "application/octet-stream",
      etag: response.headers.get("etag") ?? "",
      key,
      size: Number(response.headers.get("content-length") ?? 0),
      updatedAt: (Number.isNaN(updatedAt.getTime())
        ? now()
        : updatedAt
      ).toISOString(),
    };
  };

  return {
    delete: async (key) => {
      if (invalid(key)) {
        return err({ key, type: "invalid_key" });
      }
      const response = await send(key, { method: "DELETE" });
      if (!response.ok) {
        return response;
      }
      // S3 answers 204 whether or not the key existed.
      return response.value.ok || response.value.status === 404
        ? ok(undefined)
        : err(failed(key, response.value));
    },

    get: async (key) => {
      if (invalid(key)) {
        return err({ key, type: "invalid_key" });
      }
      const response = await send(key, { method: "GET" });
      if (!response.ok) {
        return response;
      }
      const { value } = response;
      if (!(value.ok && value.body)) {
        await value.body?.cancel();
        return err(failed(key, value));
      }
      return ok({ body: value.body, object: objectOf(key, value) });
    },

    put: async (key, body, { contentType }) => {
      if (invalid(key)) {
        return err({ key, type: "invalid_key" });
      }
      // S3 needs a length up front; uploads are capped (`limits.uploadMaxMb`), so buffer.
      // A fresh ArrayBuffer-backed copy is also what `fetch` accepts as a body.
      const bytes =
        body instanceof Uint8Array
          ? new Uint8Array(body)
          : new Uint8Array(await new Response(body).arrayBuffer());
      const response = await send(key, {
        body: bytes,
        headers: {
          "content-length": String(bytes.length),
          "content-type": contentType,
        },
        method: "PUT",
      });
      if (!response.ok) {
        return response;
      }
      if (!response.value.ok) {
        return err(failed(key, response.value));
      }
      return ok({
        contentType,
        etag: response.value.headers.get("etag") ?? "",
        key,
        size: bytes.length,
        updatedAt: now().toISOString(),
      });
    },

    signedUrl: async (key, { contentType, expiresInSeconds, method }) => {
      if (invalid(key)) {
        return err({ key, type: "invalid_key" });
      }
      const url = new URL(urlOf(key));
      url.searchParams.set("X-Amz-Expires", String(expiresInSeconds));
      try {
        const signed = await client.sign(url.toString(), {
          aws: {
            // Signing every header pins the PUT's content type into the URL.
            allHeaders: true,
            datetime: amzDate(now()),
            signQuery: true,
          },
          headers:
            method === "PUT" && contentType
              ? { "content-type": contentType }
              : {},
          method,
        });
        return ok({
          expiresAt: new Date(
            now().getTime() + expiresInSeconds * 1000
          ).toISOString(),
          url: signed.url,
        });
      } catch {
        return err(unavailable("the URL couldn't be signed"));
      }
    },

    stat: async (key) => {
      if (invalid(key)) {
        return err({ key, type: "invalid_key" });
      }
      const response = await send(key, { method: "HEAD" });
      if (!response.ok) {
        return response;
      }
      return response.value.ok
        ? ok(objectOf(key, response.value))
        : err(failed(key, response.value));
    },
  };
};
