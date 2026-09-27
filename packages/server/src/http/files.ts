import { fileIdSchema } from "@workspace/contract/schemas/common";
import type { Db } from "@workspace/db/client";
import {
  getFileByStorageKey,
  getReadableFile,
} from "@workspace/db/queries/files";
import type { Hono } from "hono";

import { actorFor, type SessionResolver } from "../context";
import type { Storage, StoredObject } from "../ports/storage";
import { verifyLocalSignature } from "../storage/local";
import { problem } from "./problem";

// Serving stored files (021, Q26). Two ways in:
// - `GET /api/files/:id/content`, for a signed-in reader (the address the
//   run executor gives answers' `file` parts);
// - `GET /api/storage/<key>?…`, the local driver's signed URLs (`files.getUrl`),
//   where the signature is the access check.
// Either way the bytes go out as a download that can't run on our origin:
// `Content-Disposition: attachment`, `nosniff`, and a CSP that allows
// nothing, on top of text of any kind having been stored as `text/plain`.

const ASCII_UNSAFE = /[^\x20-\x7e]|["\\]/g;

/** `attachment` with an ASCII fallback name and the exact one per RFC 6266. */
export const contentDisposition = (name: string | null): string => {
  if (!name) {
    return "attachment";
  }
  const fallback = name.replace(ASCII_UNSAFE, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
};

export const downloadHeaders = (
  object: StoredObject,
  name: string | null
): Headers =>
  new Headers({
    "cache-control": "private, no-cache",
    "content-disposition": contentDisposition(name),
    "content-length": String(object.size),
    "content-security-policy": "default-src 'none'; sandbox",
    "content-type": object.contentType,
    etag: object.etag,
    "x-content-type-options": "nosniff",
  });

const serve = async (
  storage: Storage,
  key: string,
  name: string | null
): Promise<Response> => {
  const found = await storage.get(key);
  if (!found.ok) {
    return found.error.type === "unavailable"
      ? problem(
          503,
          "SERVICE_UNAVAILABLE",
          "Storage is unavailable. Try again shortly."
        )
      : problem(404, "NOT_FOUND", "Not found.");
  }
  return new Response(found.value.body, {
    headers: downloadHeaders(found.value.object, name),
  });
};

export interface FileRouteDeps {
  readonly db: Db;
  readonly resolveSession: SessionResolver;
  /** The local driver's URL secret; `null` for S3, whose URLs S3 serves itself. */
  readonly signingSecret: string | null;
  readonly storage: Storage;
}

export const mountFileRoutes = (
  app: Hono,
  { db, resolveSession, signingSecret, storage }: FileRouteDeps
) => {
  app.get("/api/files/:id/content", async (c) => {
    const session = await resolveSession(c.req.raw);
    if (!session) {
      return problem(401, "UNAUTHORIZED", "Sign in to continue.");
    }
    const id = fileIdSchema.safeParse(c.req.param("id"));
    const found = id.success
      ? await getReadableFile(db, await actorFor(db, session), id.data)
      : null;
    if (!found?.ok) {
      return problem(404, "NOT_FOUND", "Not found.");
    }
    return serve(storage, found.value.storageKey, found.value.name);
  });

  app.get("/api/storage/*", async (c) => {
    if (!signingSecret) {
      return problem(404, "NOT_FOUND", "Not found.");
    }
    const { pathname, searchParams } = new URL(c.req.url);
    let key: string;
    try {
      key = pathname
        .slice("/api/storage/".length)
        .split("/")
        .map(decodeURIComponent)
        .join("/");
    } catch {
      return problem(404, "NOT_FOUND", "Not found.");
    }
    const verified = verifyLocalSignature(
      {
        contentType: searchParams.get("contentType") ?? "",
        expires: searchParams.get("expires") ?? "",
        key,
        method: "GET",
        signature: searchParams.get("signature") ?? "",
      },
      signingSecret
    );
    // The method is part of what's signed and fixed to GET here, so a URL
    // signed for an upload can't be used to read.
    if (!verified.ok) {
      return problem(403, "FORBIDDEN", "This link is invalid or has expired.");
    }
    const file = await getFileByStorageKey(db, key);
    return serve(storage, key, file?.name ?? null);
  });
};
