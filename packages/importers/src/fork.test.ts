import type { MessageId } from "@workspace/contract/schemas/common";
import type { MessagePart } from "@workspace/contract/schemas/message-parts";
import {
  createConversation,
  getConversationWithBranch,
} from "@workspace/db/queries/conversations";
import { insertMessage } from "@workspace/db/queries/messages";
import { conversation, message } from "@workspace/db/schema/chat";
import {
  createTestDb,
  expectOk,
  seedOrg,
  seedTeam,
  seedUser,
  type TestDb,
} from "@workspace/db/testing";
import { newId } from "@workspace/shared/ids";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { type ForkMode, forkConversation, selectForFork } from "./fork";

// The tree every test forks, target `a2` at depth 3:
//
//   r1 ─┬─ a1 ─┬─ u2 ── a2 ── u3
//       │      └─ u2b ── a2b
//       └─ a1b ── u2c
//   r1b                        (a root sibling: the first message, edited)
const TREE = [
  ["r1", null],
  ["a1", "r1"],
  ["u2", "a1"],
  ["a2", "u2"],
  ["u3", "a2"],
  ["u2b", "a1"],
  ["a2b", "u2b"],
  ["a1b", "r1"],
  ["u2c", "a1b"],
  ["r1b", null],
] as const;

const nodes = TREE.map(([id, parentId]) => ({ id, parentId }));

const select = (target: string, mode: ForkMode) =>
  selectForFork(nodes, target, mode)?.map((node) => node.id);

describe("selectForFork", () => {
  test("direct-path: the target and its ancestors", () => {
    expect(select("a2", "direct-path")).toEqual(["r1", "a1", "u2", "a2"]);
  });

  test("include-branches: the path and its siblings, not the target's children", () => {
    expect(select("a2", "include-branches")).toEqual([
      "r1",
      "a1",
      "u2",
      "a2",
      "u2b",
      "a1b",
      "r1b",
    ]);
  });

  test("target-level: every branch down to the target's depth", () => {
    expect(select("a2", "target-level")).toEqual([
      "r1",
      "a1",
      "u2",
      "a2",
      "u2b",
      "a2b",
      "a1b",
      "u2c",
      "r1b",
    ]);
    expect(select("r1", "target-level")).toEqual(["r1", "r1b"]);
  });

  test("a root target keeps just the root, or its root siblings", () => {
    expect(select("r1", "direct-path")).toEqual(["r1"]);
    expect(select("r1", "include-branches")).toEqual(["r1", "r1b"]);
  });

  test("an unknown target selects nothing", () => {
    expect(select("nope", "direct-path")).toBeUndefined();
  });
});

let testDb: TestDb;
beforeAll(async () => {
  testDb = await createTestDb();
});
afterAll(() => testDb.close());

const text = (value: string): MessagePart[] => [{ text: value, type: "text" }];

/** The tree above as a stored conversation; returns its ids by name. */
const setup = async () => {
  const { db } = testDb;
  const owner = await seedUser(db);
  const org = await seedOrg(db, owner.id, { isPersonal: true });
  const chat = await createConversation(db, {
    context: { id: org.id, type: "personal" },
    ownerId: owner.id,
    title: "Source",
  });
  const ids = new Map<string, MessageId>();
  for (const [name, parent] of TREE) {
    const row = expectOk(
      // biome-ignore lint/performance/noAwaitInLoops: parents are written before their children.
      await insertMessage(db, {
        authorId: name.startsWith("a") ? null : owner.id,
        conversationId: chat.id,
        model: name.startsWith("a") ? "openai:gpt-4o" : null,
        parentId: parent === null ? null : (ids.get(parent) ?? null),
        parts: text(name),
        role: name.startsWith("a") ? "assistant" : "user",
      })
    );
    ids.set(name, row.id);
  }
  return { chat, db, ids, org, owner };
};

/** The copy's messages as `name -> parent name`, read back through their text. */
const copiedTree = async (conversationId: string) => {
  const rows = await testDb.db
    .select()
    .from(message)
    .where(eq(message.conversationId, conversationId as never))
    .orderBy(asc(message.createdAt), asc(message.id));
  const nameOf = new Map(
    rows.map((row) => [row.id, (row.parts[0] as { text: string }).text])
  );
  return {
    rows,
    tree: Object.fromEntries(
      rows.map((row) => [
        nameOf.get(row.id),
        row.parentId === null ? null : (nameOf.get(row.parentId) ?? "?"),
      ])
    ),
  };
};

describe("forkConversation", () => {
  test("copies the branch into a new conversation that opens on the copied leaf", async () => {
    const { chat, db, ids, org, owner } = await setup();
    const fork = expectOk(
      await forkConversation(db, {
        conversationId: chat.id,
        leafMessageId: ids.get("a2") as MessageId,
        ownerId: owner.id,
      })
    );
    expect(fork.conversationId).not.toBe(chat.id);
    expect(fork.messageCount).toBe(4);

    const { rows, tree } = await copiedTree(fork.conversationId);
    expect(tree).toEqual({ a1: "r1", a2: "u2", r1: null, u2: "a1" });
    // Fresh ids, same content and timestamps.
    expect(rows.some((row) => [...ids.values()].includes(row.id))).toBe(false);
    const sourceA2 = await db
      .select()
      .from(message)
      .where(eq(message.id, ids.get("a2") as MessageId));
    const copyA2 = rows.find((row) => row.id === fork.leafId);
    expect(copyA2?.createdAt).toEqual(sourceA2[0]?.createdAt);
    expect(copyA2?.model).toBe("openai:gpt-4o");
    expect(copyA2?.runId).toBeNull();

    const [copy] = await db
      .select()
      .from(conversation)
      .where(eq(conversation.id, fork.conversationId));
    expect(copy).toMatchObject({
      contextId: org.id,
      contextType: "personal",
      ownerId: owner.id,
      title: "Source",
    });
    const opened = expectOk(
      await getConversationWithBranch(db, fork.conversationId, {
        principals: [{ id: owner.id, type: "user" }],
        userId: owner.id,
      })
    );
    expect(opened.branch.leafId).toBe(fork.leafId);
    expect(opened.branch.messages).toHaveLength(4);
  });

  test("include-branches and target-level copy siblings too", async () => {
    const { chat, db, ids, owner } = await setup();
    const leafMessageId = ids.get("a2") as MessageId;
    const branches = expectOk(
      await forkConversation(db, {
        conversationId: chat.id,
        leafMessageId,
        mode: "include-branches",
        ownerId: owner.id,
      })
    );
    expect((await copiedTree(branches.conversationId)).tree).toEqual({
      a1: "r1",
      a1b: "r1",
      a2: "u2",
      r1: null,
      r1b: null,
      u2: "a1",
      u2b: "a1",
    });
    const level = expectOk(
      await forkConversation(db, {
        conversationId: chat.id,
        leafMessageId,
        mode: "target-level",
        ownerId: owner.id,
      })
    );
    expect((await copiedTree(level.conversationId)).tree).toEqual({
      a1: "r1",
      a1b: "r1",
      a2: "u2",
      a2b: "u2b",
      r1: null,
      r1b: null,
      u2: "a1",
      u2b: "a1",
      u2c: "a1b",
    });
  });

  test("takes a new owner, context and title", async () => {
    const { chat, db, ids, org } = await setup();
    const other = await seedUser(db);
    const team = await seedTeam(db, org.id);
    const fork = expectOk(
      await forkConversation(db, {
        context: { id: team.id, type: "team" },
        conversationId: chat.id,
        leafMessageId: ids.get("u3") as MessageId,
        ownerId: other.id,
        title: "Mine now",
      })
    );
    const [copy] = await db
      .select()
      .from(conversation)
      .where(eq(conversation.id, fork.conversationId));
    expect(copy).toMatchObject({
      contextId: team.id,
      contextType: "team",
      ownerId: other.id,
      title: "Mine now",
    });
    expect(fork.messageCount).toBe(5);
  });

  test("an unknown conversation or leaf is not_found", async () => {
    const { chat, db, owner } = await setup();
    const missing = newId("message");
    expect(
      await forkConversation(db, {
        conversationId: chat.id,
        leafMessageId: missing,
        ownerId: owner.id,
      })
    ).toEqual({
      error: { entity: "message", id: missing, type: "not_found" },
      ok: false,
    });
    const gone = newId("conversation");
    expect(
      await forkConversation(db, {
        conversationId: gone,
        leafMessageId: missing,
        ownerId: owner.id,
      })
    ).toEqual({
      error: { entity: "conversation", id: gone, type: "not_found" },
      ok: false,
    });
  });
});
