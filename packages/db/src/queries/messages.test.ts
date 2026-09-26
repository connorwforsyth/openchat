import type { MessageId } from "@workspace/contract/schemas/common";
import type { MessagePart } from "@workspace/contract/schemas/message-parts";
import { messageSchema } from "@workspace/contract/schemas/messages";
import { newId } from "@workspace/shared/ids";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  createTestDb,
  expectOk,
  seedOrg,
  seedUser,
  type TestDb,
} from "../testing";
import { createConversation, getConversation } from "./conversations";
import {
  getBranchPath,
  getMessage,
  getMessageTree,
  getSiblings,
  insertMessage,
  newestLeafId,
  siblingInfo,
  toMessage,
  updateMessage,
} from "./messages";

const text = (value: string): MessagePart[] => [{ text: value, type: "text" }];

let testDb: TestDb;
beforeAll(async () => {
  testDb = await createTestDb();
});
afterAll(() => testDb.close());

const setup = async () => {
  const { db } = testDb;
  const owner = await seedUser(db);
  const org = await seedOrg(db, owner.id, { isPersonal: true });
  const chat = await createConversation(db, {
    context: { id: org.id, type: "personal" },
    ownerId: owner.id,
  });
  const say = (
    parentId: MessageId | null,
    value: string,
    role: "user" | "assistant" = "user"
  ) =>
    insertMessage(db, {
      authorId: role === "user" ? owner.id : null,
      conversationId: chat.id,
      parentId,
      parts: text(value),
      role,
    }).then(expectOk);
  return { chat, db, owner, say };
};

describe("insertMessage", () => {
  test("locks the context and stamps activity on the first message", async () => {
    const { chat, db, owner, say } = await setup();
    expect(chat.contextLockedAt).toBeNull();
    const first = await say(null, "hello");
    const view = expectOk(
      await getConversation(db, chat.id, {
        principals: [{ id: owner.id, type: "user" }],
        userId: owner.id,
      })
    );
    expect(view.contextLockedAt).not.toBeNull();
    expect(view.lastMessageAt?.getTime()).toBe(first.createdAt.getTime());
  });

  test("rejects a missing conversation or parent", async () => {
    const { chat, db } = await setup();
    const noChat = await insertMessage(db, {
      authorId: null,
      conversationId: newId("conversation"),
      parentId: null,
      parts: text("x"),
      role: "user",
    });
    expect(noChat).toMatchObject({
      error: { entity: "conversation", type: "not_found" },
    });
    const noParent = await insertMessage(db, {
      authorId: null,
      conversationId: chat.id,
      parentId: newId("message"),
      parts: text("x"),
      role: "user",
    });
    expect(noParent).toMatchObject({
      error: { entity: "message", type: "not_found" },
    });
  });

  test("rejects a parent from another conversation", async () => {
    const a = await setup();
    const b = await setup();
    const foreign = await b.say(null, "elsewhere");
    const result = await insertMessage(a.db, {
      authorId: a.owner.id,
      conversationId: a.chat.id,
      parentId: foreign.id,
      parts: text("x"),
      role: "user",
    });
    expect(result).toMatchObject({
      error: { reason: "wrong_conversation", type: "conflict" },
    });
  });
});

describe("branches", () => {
  test("walks the branch root first, with siblings for the switcher", async () => {
    const { chat, db, say } = await setup();
    const root = await say(null, "q1");
    const a1 = await say(root.id, "a1", "assistant");
    const a2 = await say(root.id, "a2 (regenerated)", "assistant");
    const q2 = await say(a2.id, "q2");
    const other = await say(a1.id, "q2 on the first branch");

    const branch = expectOk(await getBranchPath(db, chat.id, q2.id));
    expect(branch.messages.map((m) => m.id)).toEqual([root.id, a2.id, q2.id]);
    expect(branch.siblings).toEqual([
      { index: 0, messageId: root.id, siblingIds: [root.id] },
      { index: 1, messageId: a2.id, siblingIds: [a1.id, a2.id] },
      { index: 0, messageId: q2.id, siblingIds: [q2.id] },
    ]);

    expect(await newestLeafId(db, chat.id)).toBe(other.id);
    expect(expectOk(await getSiblings(db, a1.id))).toEqual({
      index: 0,
      messageId: a1.id,
      siblingIds: [a1.id, a2.id],
    });

    const tree = await getMessageTree(db, chat.id);
    expect(tree.map((node) => node.id)).toEqual([
      root.id,
      a1.id,
      a2.id,
      q2.id,
      other.id,
    ]);
  });

  test("an edited first message is a sibling root", async () => {
    const { chat, db, say } = await setup();
    const first = await say(null, "draft one");
    const second = await say(null, "draft two");
    const branch = expectOk(await getBranchPath(db, chat.id, second.id));
    expect(branch.siblings).toEqual([
      { index: 1, messageId: second.id, siblingIds: [first.id, second.id] },
    ]);
  });

  test("a leaf from another conversation is not found", async () => {
    const a = await setup();
    const b = await setup();
    const foreign = await b.say(null, "elsewhere");
    expect(await getBranchPath(a.db, a.chat.id, foreign.id)).toMatchObject({
      error: { type: "not_found" },
    });
  });

  test("siblingInfo falls back to the node itself", () => {
    const id = newId("message");
    expect(siblingInfo([{ id, parentId: null }], [])).toEqual([
      { index: 0, messageId: id, siblingIds: [id] },
    ]);
  });
});

describe("updateMessage and toMessage", () => {
  test("a finished answer maps to a valid contract message", async () => {
    const { db, say } = await setup();
    const question = await say(null, "q");
    const answer = await say(question.id, "", "assistant");
    const updated = expectOk(
      await updateMessage(db, answer.id, {
        model: "ollama:llama3",
        parts: [{ type: "step-start" }, { text: "the answer", type: "text" }],
        status: "complete",
        usage: { inputTokens: 3, outputTokens: 2 },
      })
    );
    expect(updated.parts).toHaveLength(2);
    const reread = expectOk(await getMessage(db, answer.id));
    const mapped = expectOk(toMessage(reread));
    expect(messageSchema.parse(mapped)).toEqual(mapped);
    expect(mapped).toMatchObject({ model: "ollama:llama3", role: "assistant" });
  });

  test("an unknown parts version is an error, not a crash", async () => {
    const { db, say } = await setup();
    const row = expectOk(await getMessage(db, (await say(null, "q")).id));
    expect(toMessage({ ...row, partsVersion: 99 })).toMatchObject({
      error: { type: "unsupported_parts_version", version: 99 },
    });
  });

  test("updating a missing message is not found", async () => {
    const { db } = await setup();
    expect(
      await updateMessage(db, newId("message"), { status: "error" })
    ).toMatchObject({ error: { type: "not_found" } });
  });
});
