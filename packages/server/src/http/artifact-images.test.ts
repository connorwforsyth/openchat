import { TINY_PNG_BASE64 } from "@workspace/ai/testing/mock-image-model";
import type { UserId } from "@workspace/contract/schemas/common";
import type { Db } from "@workspace/db/client";
import { saveArtifactVersion } from "@workspace/db/queries/artifacts";
import { createConversation } from "@workspace/db/queries/conversations";
import { insertMessage } from "@workspace/db/queries/messages";
import {
  createTestDb,
  expectOk,
  seedOrg,
  seedUser,
  type TestDb,
} from "@workspace/db/testing";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { grantAccess } from "../context";
import { USER_HEADER } from "../testing/harness";
import {
  artifactImagePath,
  imageOfDataUrl,
  mountArtifactImageRoutes,
} from "./artifact-images";

// An image artifact's bytes (138): served to whoever can read the artifact,
// as the image type it was saved as, and to nobody else.

let t: TestDb;
let db: Db;
let app: Hono;

beforeAll(async () => {
  t = await createTestDb();
  ({ db } = t);
  app = new Hono();
  mountArtifactImageRoutes(app, {
    access: grantAccess(db),
    db,
    resolveSession: (request) => {
      const id = request.headers.get(USER_HEADER);
      return Promise.resolve(id ? { userId: id as UserId } : null);
    },
  });
});

afterAll(() => t.close());

const seed = async (kind: "code" | "image", content: string) => {
  const owner = await seedUser(db);
  const stranger = await seedUser(db);
  const personal = await seedOrg(db, owner.id, { isPersonal: true });
  const chat = await createConversation(db, {
    context: { id: personal.id, type: "personal" },
    ownerId: owner.id,
  });
  const message = expectOk(
    await insertMessage(db, {
      authorId: null,
      conversationId: chat.id,
      parentId: null,
      parts: [{ text: "Here you go", type: "text" }],
      role: "assistant",
    })
  );
  const saved = expectOk(
    await saveArtifactVersion(db, {
      content,
      conversationId: chat.id,
      kind,
      language: null,
      messageId: message.id,
      title: "A fox / at dusk",
    })
  );
  return {
    owner,
    path: artifactImagePath(saved.artifact.id, saved.version.id),
    stranger,
  };
};

const get = (path: string, as: UserId | null) =>
  app.request(path, { headers: as ? { [USER_HEADER]: as } : {} });

describe("GET /api/artifacts/:id/versions/:versionId/image", () => {
  it("serves the picture to whoever can read the artifact", async () => {
    const { owner, path } = await seed(
      "image",
      `data:image/png;base64,${TINY_PNG_BASE64}`
    );
    const response = await get(path, owner.id);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-disposition")).toBe(
      'inline; filename="A-fox-at-dusk.png"'
    );
    expect(Buffer.from(await response.arrayBuffer()).toString("base64")).toBe(
      TINY_PNG_BASE64
    );
  });

  it("is not found for a stranger, a signed-out caller or another kind", async () => {
    const image = await seed(
      "image",
      `data:image/png;base64,${TINY_PNG_BASE64}`
    );
    expect((await get(image.path, image.stranger.id)).status).toBe(404);
    expect((await get(image.path, null)).status).toBe(401);
    const code = await seed("code", "print(1)");
    expect((await get(code.path, code.owner.id)).status).toBe(404);
  });
});

describe("imageOfDataUrl", () => {
  it("reads only base64 PNG, JPEG and WebP", () => {
    expect(
      imageOfDataUrl(`data:image/png;base64,${TINY_PNG_BASE64}`)?.mediaType
    ).toBe("image/png");
    expect(imageOfDataUrl("data:image/svg+xml;base64,PHN2Zz4=")).toBeNull();
    expect(imageOfDataUrl("data:text/html;base64,PGI+")).toBeNull();
  });
});
