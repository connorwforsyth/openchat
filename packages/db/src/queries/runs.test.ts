import { newId } from "@workspace/shared/ids";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  createTestDb,
  expectOk,
  seedOrg,
  seedUser,
  type TestDb,
} from "../testing";
import { createConversation } from "./conversations";
import { insertMessage } from "./messages";
import {
  appendRunChunks,
  canTransition,
  createRun,
  getRun,
  listActiveRuns,
  listQueuedAfter,
  pruneRunChunks,
  readRunChunks,
  transitionRun,
} from "./runs";

let testDb: TestDb;
beforeAll(async () => {
  testDb = await createTestDb();
});
afterAll(() => testDb.close());

const setup = async () => {
  const { db } = testDb;
  const owner = await seedUser(db);
  const org = await seedOrg(db, owner.id, { isPersonal: true });
  const context = { id: org.id, type: "personal" } as const;
  const chat = await createConversation(db, { context, ownerId: owner.id });
  const question = expectOk(
    await insertMessage(db, {
      authorId: owner.id,
      conversationId: chat.id,
      parentId: null,
      parts: [{ text: "hi", type: "text" }],
      role: "user",
    })
  );
  const newRun = (extra: Partial<Parameters<typeof createRun>[1]> = {}) =>
    createRun(db, {
      context,
      conversationId: chat.id,
      createdBy: owner.id,
      target: { model: "fast", type: "model" },
      userMessageId: question.id,
      ...extra,
    });
  return { chat, db, newRun, owner, question };
};

describe("createRun", () => {
  test("an idempotency key returns the first run", async () => {
    const { newRun } = await setup();
    const first = await newRun({ idempotencyKey: "retry-key-1" });
    const again = await newRun({ idempotencyKey: "retry-key-1" });
    expect(first.created).toBe(true);
    expect(again).toEqual({ created: false, run: first.run });
    const other = await newRun();
    expect(other.created).toBe(true);
    expect(other.run.id).not.toBe(first.run.id);
  });

  test("queues behind the active run", async () => {
    const { chat, db, newRun } = await setup();
    const first = (await newRun({ status: "running" })).run;
    expect(first.startedAt).not.toBeNull();
    const second = (await newRun({ afterRunId: first.id })).run;
    expect((await listActiveRuns(db, chat.id)).map((r) => r.id)).toEqual([
      first.id,
      second.id,
    ]);
    expect((await listQueuedAfter(db, first.id)).map((r) => r.id)).toEqual([
      second.id,
    ]);
  });
});

describe("transitionRun", () => {
  test("walks the happy path with approvals", async () => {
    const { chat, db, newRun, question } = await setup();
    const { run } = await newRun();
    const answer = expectOk(
      await insertMessage(db, {
        authorId: null,
        conversationId: chat.id,
        parentId: question.id,
        parts: [],
        role: "assistant",
        runId: run.id,
        status: "partial",
      })
    );
    const started = expectOk(
      await transitionRun(db, run.id, {
        assistantMessageId: answer.id,
        executor: "in-process",
        resolvedModel: "ollama:llama3",
        type: "start",
      })
    );
    expect(started).toMatchObject({
      assistantMessageId: answer.id,
      executor: "in-process",
      status: "running",
    });

    const waiting = expectOk(
      await transitionRun(db, run.id, {
        approvals: [
          {
            input: { command: "ls" },
            requestedAt: new Date().toISOString(),
            toolCallId: "call-1",
            toolName: "bash",
          },
        ],
        type: "await_approval",
      })
    );
    expect(waiting.approvals).toHaveLength(1);
    const resumed = expectOk(
      await transitionRun(db, run.id, { type: "resume" })
    );
    expect(resumed).toMatchObject({ approvals: null, status: "running" });
    const done = expectOk(
      await transitionRun(db, run.id, {
        type: "succeed",
        usage: { inputTokens: 10, outputTokens: 5 },
      })
    );
    expect(done).toMatchObject({
      status: "succeeded",
      usage: { inputTokens: 10 },
    });
    expect(done.finishedAt).not.toBeNull();
    expect(done.userMessageId).toBe(question.id);
  });

  test("refuses to leave a terminal status", async () => {
    const { db, newRun, owner } = await setup();
    const { run } = await newRun();
    expectOk(
      await transitionRun(db, run.id, { cancelledBy: owner.id, type: "cancel" })
    );
    expect(await transitionRun(db, run.id, { type: "start" })).toMatchObject({
      error: {
        detail: "cancelled -> running",
        reason: "invalid_transition",
        type: "conflict",
      },
    });
    expect(
      await transitionRun(db, newId("run"), { type: "start" })
    ).toMatchObject({
      error: { type: "not_found" },
    });
  });

  test("records why a run failed", async () => {
    const { db, newRun } = await setup();
    const { run } = await newRun();
    const failed = expectOk(
      await transitionRun(db, run.id, {
        error: {
          code: "provider_unavailable",
          message: "No provider key",
          retryable: false,
        },
        type: "fail",
      })
    );
    expect(failed.error?.code).toBe("provider_unavailable");
    expect(expectOk(await getRun(db, run.id)).status).toBe("failed");
  });

  test("canTransition matches the state machine", () => {
    expect(canTransition("queued", "start")).toBe(true);
    expect(canTransition("running", "start")).toBe(false);
    expect(canTransition("awaiting_approval", "resume")).toBe(true);
    expect(canTransition("succeeded", "cancel")).toBe(false);
  });
});

describe("chunks", () => {
  test("gapless sequence numbers, resumable from a cursor, prunable", async () => {
    const { db, newRun } = await setup();
    const { run } = await newRun({ status: "running" });
    expect(
      expectOk(await appendRunChunks(db, run.id, [{ type: "start" }]))
    ).toBe(1);
    const results = await Promise.all([
      appendRunChunks(db, run.id, [
        { delta: "a", type: "text-delta" },
        { delta: "b", type: "text-delta" },
      ]),
      appendRunChunks(db, run.id, [{ delta: "c", type: "text-delta" }]),
    ]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(expectOk(await appendRunChunks(db, run.id, []))).toBe(4);

    const all = await readRunChunks(db, run.id);
    expect(all.map((chunk) => chunk.seq)).toEqual([1, 2, 3, 4]);
    const resumed = await readRunChunks(db, run.id, { after: 2 });
    expect(resumed.map((chunk) => chunk.seq)).toEqual([3, 4]);
    expect(expectOk(await getRun(db, run.id)).lastSeq).toBe(4);

    expect(await pruneRunChunks(db, run.id)).toBe(4);
    expect(await readRunChunks(db, run.id)).toEqual([]);
    expect(await appendRunChunks(db, newId("run"), [{}])).toMatchObject({
      error: { type: "not_found" },
    });
  });
});
