import type { UserId } from "@workspace/contract/schemas/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Db } from "../client";
import {
  createTestDb,
  expectOk,
  seedOrg,
  seedUser,
  type TestDb,
} from "../testing";
import {
  deleteArtifact,
  getArtifact,
  getArtifactPublication,
  getPublishedArtifact,
  newestMessageIn,
  publishArtifactVersion,
  saveArtifactVersion,
  unpublishArtifact,
} from "./artifacts";
import { createConversation } from "./conversations";
import { insertMessage } from "./messages";

// Sites (125): a site artifact is stored like any other, and can be
// published to one link that serves one version.

let testDb: TestDb;
let db: Db;
beforeAll(async () => {
  testDb = await createTestDb();
  ({ db } = testDb);
});
afterAll(() => testDb.close());

const SITE = JSON.stringify({ files: { "index.html": "<h1>Hi</h1>" } });

const siteIn = async (ownerId: UserId) => {
  const personal = await seedOrg(db, ownerId, { isPersonal: true });
  const chat = await createConversation(db, {
    context: { id: personal.id, type: "personal" },
    ownerId,
  });
  const empty = await newestMessageIn(db, chat.id);
  const message = expectOk(
    await insertMessage(db, {
      authorId: null,
      conversationId: chat.id,
      parentId: null,
      parts: [{ text: "Here you go", type: "text" }],
      role: "assistant",
    })
  );
  const newest = await newestMessageIn(db, chat.id);
  const saved = expectOk(
    await saveArtifactVersion(db, {
      content: SITE,
      conversationId: chat.id,
      kind: "site",
      messageId: message.id,
      title: "Harbour site",
    })
  );
  return { chat, empty, message, newest, saved };
};

describe("publishing an artifact", () => {
  it("stores site artifacts", async () => {
    const ada = await seedUser(db);
    const { empty, message, newest, saved } = await siteIn(ada.id);
    expect(empty).toBeNull();
    expect(newest).toBe(message.id);
    expect(saved.artifact.kind).toBe("site");
    expect(saved.version.content).toBe(SITE);
  });

  it("serves the published version by token, and keeps the token when published again", async () => {
    const ada = await seedUser(db);
    const { chat, message, saved } = await siteIn(ada.id);
    const artifactId = saved.artifact.id;
    expect(await getArtifactPublication(db, artifactId)).toBeNull();
    const first = await publishArtifactVersion(db, {
      artifactId,
      publishedBy: ada.id,
      token: "t".repeat(43),
      versionId: saved.version.id,
    });
    expect(await getPublishedArtifact(db, first.token)).toEqual({
      content: SITE,
      kind: "site",
      publishedAt: first.publishedAt,
      title: "Harbour site",
    });
    const next = expectOk(
      await saveArtifactVersion(db, {
        artifactId,
        content: SITE.replace("Hi", "Hello"),
        conversationId: chat.id,
        kind: "site",
        messageId: message.id,
        title: "Harbour site",
      })
    );
    // The link still serves version 1 until it's published again.
    expect((await getPublishedArtifact(db, first.token))?.content).toBe(SITE);
    const again = await publishArtifactVersion(db, {
      artifactId,
      publishedBy: ada.id,
      token: "u".repeat(43),
      versionId: next.version.id,
    });
    expect(again.token).toBe(first.token);
    expect(again.versionId).toBe(next.version.id);
    expect((await getPublishedArtifact(db, first.token))?.content).toContain(
      "Hello"
    );
  });

  it("stops serving when unpublished or deleted", async () => {
    const ada = await seedUser(db);
    const { saved } = await siteIn(ada.id);
    const token = "v".repeat(43);
    await publishArtifactVersion(db, {
      artifactId: saved.artifact.id,
      publishedBy: ada.id,
      token,
      versionId: saved.version.id,
    });
    await unpublishArtifact(db, saved.artifact.id);
    expect(await getPublishedArtifact(db, token)).toBeNull();
    await publishArtifactVersion(db, {
      artifactId: saved.artifact.id,
      publishedBy: ada.id,
      token,
      versionId: saved.version.id,
    });
    await deleteArtifact(db, saved.artifact.id);
    expect((await getArtifact(db, saved.artifact.id)).ok).toBe(false);
    expect(await getPublishedArtifact(db, token)).toBeNull();
  });

  it("gives a saved artifact the owner it's told to", async () => {
    const ada = await seedUser(db);
    const ben = await seedUser(db);
    const { chat, message } = await siteIn(ada.id);
    const saved = expectOk(
      await saveArtifactVersion(db, {
        content: SITE,
        conversationId: chat.id,
        kind: "site",
        messageId: message.id,
        ownerId: ben.id,
        title: "Ben's copy",
      })
    );
    expect(saved.artifact.ownerId).toBe(ben.id);
  });
});
