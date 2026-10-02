import {
  artifactIdSchema,
  artifactVersionIdSchema,
} from "@workspace/contract/schemas/common";
import type { Db } from "@workspace/db/client";
import {
  getArtifact,
  getArtifactVersion,
} from "@workspace/db/queries/artifacts";
import type { Hono } from "hono";

import { artifactAccessFor } from "../api/artifacts";
import {
  actorFor,
  type ConversationAccess,
  type SessionResolver,
} from "../context";
import { problem } from "./problem";

// An image artifact's picture as bytes (138), so a reply, the panel and the
// Artifacts page can show it with `<img>` and download it, without loading
// the version's data: URL as JSON. Whoever can read the artifact can read
// this; the bytes can't run on our origin (`nosniff`, a CSP that allows
// nothing, and only image types are ever stored).

const DATA_URL =
  /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/;

const EXTENSIONS: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** A version's data: URL as its bytes and type; `null` when it isn't one. Pure. */
export const imageOfDataUrl = (
  content: string
): {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly mediaType: string;
} | null => {
  const match = DATA_URL.exec(content);
  const [, mediaType, base64] = match ?? [];
  return mediaType && base64
    ? { bytes: Uint8Array.from(Buffer.from(base64, "base64")), mediaType }
    : null;
};

const SAFE_NAME = /[^\w.-]+/g;

export interface ArtifactImageRouteDeps {
  readonly access: ConversationAccess;
  readonly db: Db;
  readonly resolveSession: SessionResolver;
}

/** The path a version's image is served at. */
export const artifactImagePath = (artifactId: string, versionId: string) =>
  `/api/artifacts/${artifactId}/versions/${versionId}/image`;

export const mountArtifactImageRoutes = (
  app: Hono,
  { access, db, resolveSession }: ArtifactImageRouteDeps
) => {
  app.get("/api/artifacts/:id/versions/:versionId/image", async (c) => {
    const session = await resolveSession(c.req.raw);
    if (!session) {
      return problem(401, "UNAUTHORIZED", "Sign in to continue.");
    }
    const id = artifactIdSchema.safeParse(c.req.param("id"));
    const versionId = artifactVersionIdSchema.safeParse(
      c.req.param("versionId")
    );
    const notFound = problem(404, "NOT_FOUND", "Not found.");
    if (!(id.success && versionId.success)) {
      return notFound;
    }
    const artifact = await getArtifact(db, id.data);
    if (!artifact.ok || artifact.value.kind !== "image") {
      return notFound;
    }
    const actor = await actorFor(db, session);
    if (!(await artifactAccessFor({ access, db }, actor, artifact.value))) {
      return notFound;
    }
    const version = await getArtifactVersion(db, id.data, versionId.data);
    const image = version.ok ? imageOfDataUrl(version.value.content) : null;
    if (!image) {
      return notFound;
    }
    const name = `${artifact.value.title.replace(SAFE_NAME, "-").slice(0, 80) || "image"}.${EXTENSIONS[image.mediaType] ?? "png"}`;
    return new Response(image.bytes, {
      headers: {
        // A version never changes, so the browser may keep it.
        "cache-control": "private, max-age=31536000, immutable",
        "content-disposition": `inline; filename="${name}"`,
        "content-length": String(image.bytes.byteLength),
        "content-security-policy": "default-src 'none'; sandbox",
        "content-type": image.mediaType,
        "x-content-type-options": "nosniff",
      },
    });
  });
};
