import type { AsyncResult } from "@workspace/shared/result";
import { z } from "zod";

// The Storage port (PLAN.md §7 `file`, §8 RAG): uploaded files and other
// blobs. Adapters: a local volume (the compose default) and S3-compatible
// (MinIO, R2, S3). Keys are opaque paths chosen by the server, never by
// users, and a key never escapes the store's root.

export const storageKeySchema = z
  .string()
  .min(1)
  .max(1024)
  .regex(
    /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))[\w\-./]+$/,
    "a relative path of letters, digits, `-`, `_`, `.` and `/`, without `.` or `..` segments"
  );
export type StorageKey = z.infer<typeof storageKeySchema>;

export const storedObjectSchema = z.object({
  contentType: z.string().min(1),
  /** Changes whenever the bytes do. */
  etag: z.string(),
  key: storageKeySchema,
  size: z.int().min(0),
  updatedAt: z.iso.datetime(),
});
export type StoredObject = z.infer<typeof storedObjectSchema>;

export const storageErrorSchema = z.discriminatedUnion("type", [
  z.object({ key: z.string(), type: z.literal("not_found") }),
  z.object({ key: z.string(), type: z.literal("invalid_key") }),
  z.object({ message: z.string(), type: z.literal("unavailable") }),
]);
export type StorageError = z.infer<typeof storageErrorSchema>;

export type StorageBody = Uint8Array | ReadableStream<Uint8Array>;

export interface SignedUrlOptions {
  /** Pinned into a PUT URL, so an upload can't change the type. */
  readonly contentType?: string;
  readonly expiresInSeconds: number;
  readonly method: "GET" | "PUT";
}

export interface Storage {
  /** Idempotent: deleting a missing key succeeds. */
  delete: (key: StorageKey) => AsyncResult<void, StorageError>;
  get: (key: StorageKey) => AsyncResult<
    {
      readonly body: ReadableStream<Uint8Array>;
      readonly object: StoredObject;
    },
    StorageError
  >;
  /** Creates or replaces the object. */
  put: (
    key: StorageKey,
    body: StorageBody,
    options: { readonly contentType: string }
  ) => AsyncResult<StoredObject, StorageError>;
  /**
   * A time-limited URL for direct download or upload. The local adapter
   * signs a URL to our own route; S3 presigns.
   */
  signedUrl: (
    key: StorageKey,
    options: SignedUrlOptions
  ) => AsyncResult<
    { readonly expiresAt: string; readonly url: string },
    StorageError
  >;
  stat: (key: StorageKey) => AsyncResult<StoredObject, StorageError>;
}
