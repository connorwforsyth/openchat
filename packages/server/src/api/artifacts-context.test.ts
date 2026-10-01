import {
  type RunStart,
  runStartSchema,
} from "@workspace/ai/ports/run-executor";
import type { UserId } from "@workspace/contract/schemas/common";
import type { Db } from "@workspace/db/client";
import {
  attachArtifactToChat,
  saveArtifactVersion,
  upsertArtifactGrant,
} from "@workspace/db/queries/artifacts";
import { createConversation } from "@workspace/db/queries/conversations";
import { insertMessage } from "@workspace/db/queries/messages";
import {
  createTestDb,
  expectOk,
  seedOrg,
  seedUser,
  type TestDb,
} from "@workspace/db/testing";
import { newId } from "@workspace/shared/ids";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  attachedArtifactsFor,
  attachedArtifactsText,
  dbArtifactStore,
} from "./artifacts-context";

// "Use in chat" (124): an artifact used in another chat reaches that chat's
// model as an instructions section, and its tools can version it when the
// requester may edit it.

let t: TestDb;
let db: Db;

beforeAll(async () => {
  t = await createTestDb();
  ({ db } = t);
});

afterAll(() => t.close());

const chatOf = async (ownerId: UserId) => {
  const personal = await seedOrg(db, ownerId, { isPersonal: true });
  const chat = await createConversation(db, {
    context: { id: personal.id, type: "personal" },
    ownerId,
  });
  const message = expectOk(
    await insertMessage(db, {
      authorId: ownerId,
      conversationId: chat.id,
      parentId: null,
      parts: [{ text: "Hello", type: "text" }],
      role: "user",
    })
  );
  return { chat, message, personal };
};

const runIn = (
  chat: Awaited<ReturnType<typeof chatOf>>,
  createdBy: UserId
): RunStart =>
  runStartSchema.parse({
    context: { type: "personal" },
    conversationId: chat.chat.id,
    createdBy,
    runId: newId("run"),
    target: { model: "mock:echo", type: "model" },
    userMessageId: chat.message.id,
  });

describe("attachedArtifactsText", () => {
  it("says nothing without attachments", () => {
    expect(attachedArtifactsText([])).toBeUndefined();
  });

  it("shows each one with its id and whether it can be changed", () => {
    const text = attachedArtifactsText([
      {
        artifactId: "0199a000-0000-7000-8000-000000000001" as never,
        content: "Day one",
        editable: false,
        kind: "markdown",
        language: null,
        title: 'The "plan"',
      },
    ]);
    expect(text).toContain(
      '<artifact id="0199a000-0000-7000-8000-000000000001" title="The \'plan\'" type="markdown" access="read-only">\nDay one\n</artifact>'
    );
    expect(text).toContain("update_artifact");
  });
});

describe("a chat an artifact is used in", () => {
  it("sees it, and versions it only when the requester may edit it", async () => {
    const ada = await seedUser(db);
    const ben = await seedUser(db);
    const origin = await chatOf(ada.id);
    const made = expectOk(
      await saveArtifactVersion(db, {
        content: "Day one: the harbour.",
        conversationId: origin.chat.id,
        kind: "markdown",
        messageId: origin.message.id,
        title: "Trip plan",
      })
    );
    const { id } = made.artifact;
    const bensChat = await chatOf(ben.id);
    await attachArtifactToChat(db, {
      addedBy: ben.id,
      artifactId: id,
      conversationId: bensChat.chat.id,
    });
    await upsertArtifactGrant(db, {
      artifactId: id,
      grantedBy: ada.id,
      permission: "viewer",
      principal: { id: ben.id, type: "user" },
    });
    const run = runIn(bensChat, ben.id);

    expect(await attachedArtifactsFor(db, run)).toEqual([
      expect.objectContaining({
        artifactId: id,
        content: "Day one: the harbour.",
        editable: false,
      }),
    ]);
    const store = dbArtifactStore(db, run);
    expect(await store.list()).toEqual([]);
    const refused = await store.save({
      artifactId: id,
      content: "Day two",
      kind: "markdown",
      language: null,
      title: "Trip plan",
    });
    expect(refused.ok).toBe(false);

    // An editor's run saves the next version from Ben's chat.
    await upsertArtifactGrant(db, {
      artifactId: id,
      grantedBy: ada.id,
      permission: "editor",
      principal: { id: ben.id, type: "user" },
    });
    expect(await store.list()).toEqual([
      expect.objectContaining({ artifactId: id }),
    ]);
    const saved = expectOk(
      await store.save({
        artifactId: id,
        content: "Day one: the harbour. Day two: the hills.",
        kind: "markdown",
        language: null,
        title: "Trip plan",
      })
    );
    expect(saved).toMatchObject({ artifactId: id, version: 2 });
  });
});
