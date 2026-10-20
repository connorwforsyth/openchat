import type { AvatarStore } from "@workspace/auth/ports/avatar-store";
import { err, ok } from "@workspace/shared/result";
import type { Hono } from "hono";

import type { SessionResolver } from "../context";
import type { Storage } from "../ports/storage";
import { problem } from "./problem";

// Profile photos copied from a sign-in provider (Microsoft, 186), kept in
// the Storage port under `avatars/` and served at `/api/avatars/<key>` to
// signed-in people. Keys change with the photo, so a response never goes
// stale and can be cached for good.

export const AVATAR_ROUTE = "/api/avatars";
const PREFIX = "avatars/";
const IMAGE_TYPES: ReadonlySet<string> = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

/** `AvatarStore` over the Storage port; URLs are `<origin>/api/avatars/<key>`. */
export const avatarStoreFor = (
  storage: Storage,
  origin: string
): AvatarStore => {
  const url = (key: string) => `${origin}${AVATAR_ROUTE}/${key}`;
  return {
    find: async (key) =>
      (await storage.stat(`${PREFIX}${key}`)).ok ? url(key) : undefined,
    put: async (key, bytes, contentType) => {
      const stored = await storage.put(`${PREFIX}${key}`, bytes, {
        contentType,
      });
      return stored.ok ? ok(url(key)) : err(stored.error.type);
    },
  };
};

export const mountAvatarRoutes = (
  app: Hono,
  {
    resolveSession,
    storage,
  }: { readonly resolveSession: SessionResolver; readonly storage: Storage }
) => {
  app.get(`${AVATAR_ROUTE}/*`, async (c) => {
    if (!(await resolveSession(c.req.raw))) {
      return problem(401, "UNAUTHORIZED", "Sign in to continue.");
    }
    const key = new URL(c.req.url).pathname.slice(AVATAR_ROUTE.length + 1);
    const found = await storage.get(`${PREFIX}${key}`);
    if (!found.ok) {
      return problem(404, "NOT_FOUND", "Not found.");
    }
    const { body, object } = found.value;
    // Only ever images we stored; anything else isn't served inline.
    if (!IMAGE_TYPES.has(object.contentType)) {
      await body.cancel().catch(() => undefined);
      return problem(404, "NOT_FOUND", "Not found.");
    }
    return new Response(body, {
      headers: {
        "cache-control": "private, max-age=31536000, immutable",
        "content-length": String(object.size),
        "content-security-policy": "default-src 'none'; sandbox",
        "content-type": object.contentType,
        etag: object.etag,
        "x-content-type-options": "nosniff",
      },
    });
  });
};
