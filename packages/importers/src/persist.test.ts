import type { ConversationId } from "@workspace/contract/schemas/common";
import {
  getConversationWithBranch,
  type StoredContext,
} from "@workspace/db/queries/conversations";
import { getMessageTree } from "@workspace/db/queries/messages";
import { conversation, message } from "@workspace/db/schema/chat";
import {
  createTestDb,
  expectOk,
  seedOrg,
  seedTeam,
  seedUser,
  type TestDb,
} from "@workspace/db/testing";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { parseExport, parseExportStream } from "./parse";
import { persistImport } from "./persist";
import type { ImportedConversation } from "./schema";
import { fixture, fixtureText } from "./testing";

let testDb: TestDb;
beforeAll(async () => {
  testDb = await createTestDb();
});
afterAll(() => testDb.close());

const setup = async () => {
  const { db } = testDb;
  const owner = await seedUser(db);
  const org = await seedOrg(db, owner.id, { isPersonal: true });
  const personal: StoredContext = { id: org.id, type: "personal" };
  const viewer = {
    principals: [{ id: owner.id, type: "user" as const }],
    userId: owner.id,
  };
  return { db, owner, personal, viewer };
};

const rowsOf = (id: ConversationId) =>
  testDb.db
    .select()
    .from(message)
    .where(eq(message.conversationId, id))
    .orderBy(asc(message.createdAt), asc(message.id));

const now = () => new Date(0);

describe("persistImport", () => {
  test("writes each conversation's full tree with fresh ids and export timestamps", async () => {
    const { db, owner, personal, viewer } = await setup();
    const parsed = parseExport(fixture("chatgpt-conversations.json"), { now });
    const result = expectOk(
      await persistImport(db, owner.id, personal, parsed)
    );

    expect(
      result.imported.map((c) => [c.index, c.sourceId, c.messageCount])
    ).toEqual([
      [0, "conv-branches", 7],
      [1, "conv-citations", 2],
    ]);
    expect(result.failures).toEqual([
      { index: 2, reason: "empty", sourceId: "conv-empty" },
    ]);
    expect(result.messageCount).toBe(9);

    const id = result.imported[0]?.conversationId as ConversationId;
    const [row] = await db
      .select()
      .from(conversation)
      .where(eq(conversation.id, id));
    expect(row).toMatchObject({
      contextId: personal.id,
      contextType: "personal",
      ownerId: owner.id,
      title: "Weekend in Lisbon",
    });
    expect(row?.createdAt.toISOString()).toBe("2024-05-01T17:36:40.000Z");
    expect(row?.contextLockedAt).not.toBeNull();

    const rows = await rowsOf(id);
    const imported = (parsed[0] as { value: ImportedConversation }).value;
    // Same shape as the export, re-keyed: map each row back by its text.
    const bySource = new Map(
      imported.messages.map((m, i) => [m.sourceId, rows[i]?.id])
    );
    expect(rows.map((r) => r.parentId)).toEqual(
      imported.messages.map((m) =>
        m.parentSourceId === null ? null : bySource.get(m.parentSourceId)
      )
    );
    expect(rows.map((r) => r.createdAt.toISOString())).toEqual(
      imported.messages.map((m) => m.createdAt)
    );
    expect(
      rows.every((r) => !imported.messages.some((m) => m.sourceId === r.id))
    ).toBe(true);
    expect(
      rows
        .filter((r) => r.role === "user")
        .every((r) => r.authorId === owner.id)
    ).toBe(true);
    expect(
      rows
        .filter((r) => r.role === "assistant")
        .every((r) => r.authorId === null)
    ).toBe(true);
    expect(await getMessageTree(db, id)).toHaveLength(7);

    // The branch the user was on in ChatGPT is the one that opens.
    const opened = expectOk(await getConversationWithBranch(db, id, viewer));
    expect(opened.branch.leafId).toBe(bySource.get("thoughts"));
    expect(opened.branch.messages.map((m) => m.id)).toEqual(
      ["u1", "a1", "u2", "thoughts"].map((s) => bySource.get(s))
    );
    expect(opened.conversation.visibility).toBe("private");
  });

  test("writes a streamed export as it's parsed, into a team context", async () => {
    const { db, owner } = await setup();
    const org = await seedOrg(db, owner.id);
    const team = await seedTeam(db, org.id);
    const stream = parseExportStream([
      fixtureText("claude-conversations.json"),
    ]);
    const result = expectOk(
      await persistImport(db, owner.id, { id: team.id, type: "team" }, stream)
    );
    expect(result.imported.map((c) => c.messageCount)).toEqual([4, 5]);
    const [row] = await db
      .select()
      .from(conversation)
      .where(
        eq(
          conversation.id,
          result.imported[1]?.conversationId as ConversationId
        )
      );
    expect(row).toMatchObject({ contextId: team.id, contextType: "team" });
  });

  test("skips a bad conversation and imports the rest", async () => {
    const { db, owner, personal } = await setup();
    const [good] = parseExport(fixture("librechat-flat.json"));
    const { value } = good as { value: ImportedConversation };
    const orphaned: ImportedConversation = {
      ...value,
      messages: value.messages.map((m, i) =>
        i === 1 ? { ...m, parentSourceId: "nowhere" } : m
      ),
      sourceId: "orphaned",
    };
    const result = expectOk(
      await persistImport(db, owner.id, personal, [
        orphaned,
        { junk: true } as unknown as ImportedConversation,
        value,
      ])
    );
    expect(result.imported.map((c) => [c.index, c.sourceId])).toEqual([
      [2, "lc-flat"],
    ]);
    expect(result.failures).toEqual([
      {
        detail: `parent of ${value.messages[1]?.sourceId} missing or listed after it`,
        index: 0,
        reason: "invalid_tree",
        sourceId: "orphaned",
      },
      expect.objectContaining({ index: 1, reason: "invalid_shape" }),
    ]);
  });

  test("is an error when nothing could be imported", async () => {
    const { db, owner, personal } = await setup();
    const result = await persistImport(
      db,
      owner.id,
      personal,
      parseExport({ not: "an export" })
    );
    expect(result).toEqual({
      error: {
        failures: [{ index: 0, reason: "unknown_format", sourceId: null }],
        type: "nothing_imported",
      },
      ok: false,
    });
    expect(expectOk(await persistImport(db, owner.id, personal, []))).toEqual({
      failures: [],
      imported: [],
      messageCount: 0,
    });
  });

  test("writes large conversations in batches", async () => {
    const { db, owner, personal } = await setup();
    const base = Date.parse("2024-01-01T00:00:00Z");
    const messages = Array.from({ length: 1201 }, (_, i) => ({
      createdAt: new Date(base + i).toISOString(),
      model: null,
      parentSourceId: i === 0 ? null : `m${i - 1}`,
      parts: [{ text: `turn ${i}`, type: "text" as const }],
      role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
      sourceId: `m${i}`,
      status: "complete" as const,
    }));
    const result = expectOk(
      await persistImport(db, owner.id, personal, [
        {
          activeLeafSourceId: null,
          createdAt: messages[0]?.createdAt as string,
          messages,
          source: "librechat",
          sourceId: "long",
          title: null,
        },
      ])
    );
    expect(result.messageCount).toBe(1201);
    const rows = await rowsOf(
      result.imported[0]?.conversationId as ConversationId
    );
    expect(rows).toHaveLength(1201);
  });
});
