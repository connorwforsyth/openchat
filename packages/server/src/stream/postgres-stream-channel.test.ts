import type {
  ConversationId,
  JsonValue,
  RunId,
} from "@workspace/contract/schemas/common";
import { createConversation } from "@workspace/db/queries/conversations";
import { insertMessage } from "@workspace/db/queries/messages";
import { createRun, transitionRun } from "@workspace/db/queries/runs";
import {
  createTestDb,
  expectOk,
  seedOrg,
  seedUser,
  type TestDb,
} from "@workspace/db/testing";
import type { Result } from "@workspace/shared/result";
import { readUIMessageStream, type UIMessage, type UIMessageChunk } from "ai";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { StreamChannel, StreamEvent } from "../ports/stream-channel";
import { type PgliteListener, pgliteListen } from "./listen";
import { createPostgresStreamChannel } from "./postgres-stream-channel";
import { cursorFrom } from "./sse";

// The Postgres StreamChannel against PGlite, which supports LISTEN/NOTIFY:
// the same contract as the in-memory fake (ordered seqs, replay from a
// cursor, live fan-out, `end` after the run's terminal transition).

let testDb: TestDb;
beforeAll(async () => {
  testDb = await createTestDb();
});
afterAll(() => testDb.close());

const newRun = async (): Promise<RunId> => {
  const { db } = testDb;
  const owner = await seedUser(db);
  const org = await seedOrg(db, owner.id, { isPersonal: true });
  const context = { id: org.id, type: "personal" } as const;
  const chat = await createConversation(db, { context, ownerId: owner.id });
  const question = expectOk(
    await insertMessage(db, {
      authorId: owner.id,
      conversationId: chat.id as ConversationId,
      parentId: null,
      parts: [{ text: "hi", type: "text" }],
      role: "user",
    })
  );
  const { run } = await createRun(db, {
    context,
    conversationId: chat.id,
    createdBy: owner.id,
    status: "running",
    target: { model: "fast", type: "model" },
    userMessageId: question.id,
  });
  return run.id;
};

const channelFor = (listen: boolean) =>
  createPostgresStreamChannel({
    db: testDb.db,
    listen:
      listen && testDb.engine === "pglite"
        ? pgliteListen(
            (testDb.db as unknown as { $client: PgliteListener }).$client
          )
        : undefined,
    pollIntervalMs: listen ? 5000 : 20,
  });

const collect = async (
  subscribed: Result<AsyncIterable<StreamEvent>, unknown>
) => {
  if (!subscribed.ok) {
    throw new Error("subscribe failed");
  }
  const seen: StreamEvent[] = [];
  for await (const event of subscribed.value) {
    seen.push(event);
  }
  return seen;
};

/** What a client renders from these chunks: the AI SDK's own reassembly. */
const render = async (payloads: readonly unknown[]) => {
  let message: UIMessage | undefined;
  const stream = new ReadableStream<UIMessageChunk>({
    start: (controller) => {
      for (const payload of payloads) {
        controller.enqueue(payload as UIMessageChunk);
      }
      controller.close();
    },
  });
  for await (const snapshot of readUIMessageStream({ stream })) {
    message = snapshot;
  }
  return message?.parts;
};

/** A long answer: some reasoning, then 2,000 text deltas, as a provider streams them. */
const longAnswer = (): UIMessageChunk[] => [
  { type: "start" },
  { type: "start-step" },
  { id: "r1", type: "reasoning-start" },
  ...Array.from({ length: 200 }, (_, index) => ({
    delta: `thought ${index}. `,
    id: "r1",
    type: "reasoning-delta" as const,
  })),
  { id: "r1", type: "reasoning-end" },
  { id: "t1", type: "text-start" },
  ...Array.from({ length: 2000 }, (_, index) => ({
    delta: `word${index} `,
    id: "t1",
    type: "text-delta" as const,
  })),
  { id: "t1", type: "text-end" },
  { type: "finish-step" },
  { type: "finish" },
];

/**
 * Appends the way the executor's `pipeToStream` does: read a chunk, append
 * it without waiting. The source yields to the event loop now and then, as
 * a provider's network reads do, so the chunks land in several batches.
 */
const pipe = async (
  channel: Pick<StreamChannel, "append">,
  runId: RunId,
  chunks: readonly UIMessageChunk[]
) => {
  let index = 0;
  const reader = new ReadableStream<UIMessageChunk>({
    pull: async (controller) => {
      if (index % 50 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      const chunk = chunks[index];
      index += 1;
      if (chunk) {
        controller.enqueue(chunk);
      } else {
        controller.close();
      }
    },
  }).getReader();
  const appends: ReturnType<StreamChannel["append"]>[] = [];
  for (;;) {
    // biome-ignore lint/performance/noAwaitInLoops: chunks are copied in order, like the executor.
    const next = await reader.read();
    if (next.done) {
      break;
    }
    appends.push(channel.append(runId, next.value as JsonValue));
  }
  return await Promise.all(appends);
};

describe.each([
  ["LISTEN/NOTIFY", true],
  ["polling", false],
])("Postgres StreamChannel (%s)", (_name, listen) => {
  it("numbers appends in call order, batching concurrent ones", async () => {
    const channel = channelFor(listen);
    const runId = await newRun();
    const seqs = await Promise.all(
      ["a", "b", "c"].map((text) => channel.append(runId, { text }))
    );
    expect(seqs.map((seq) => seq.ok && seq.value)).toEqual([1, 2, 3]);
    await channel.stop();
  });

  it("replays after a cursor, follows live chunks, then ends", async () => {
    const channel = channelFor(listen);
    const runId = await newRun();
    await channel.append(runId, { n: 1 });
    await channel.append(runId, { n: 2 });
    const subscribed = await channel.subscribe(runId, { cursor: 1 });
    const events = collect(subscribed);
    await channel.append(runId, { n: 3 });
    await transitionRun(testDb.db, runId, { type: "succeed" });
    expect((await channel.close(runId, "succeeded")).ok).toBe(true);
    expect(await events).toEqual([
      { payload: { n: 2 }, seq: 2, type: "chunk" },
      { payload: { n: 3 }, seq: 3, type: "chunk" },
      { status: "succeeded", type: "end" },
    ]);
    // Closed: nothing more goes in, and a late subscriber replays and ends.
    expect(await channel.append(runId, { n: 4 })).toEqual({
      error: { runId, type: "closed" },
      ok: false,
    });
    const late = await channel.subscribe(runId);
    expect((await collect(late)).length).toBe(4);
    await channel.prune(runId);
    const pruned = await channel.subscribe(runId);
    expect(await collect(pruned)).toEqual([
      { status: "succeeded", type: "end" },
    ]);
    await channel.stop();
  });

  it("stores a batch's adjacent deltas as one row its appends share", async () => {
    const channel = channelFor(listen);
    const runId = await newRun();
    const chunks: JsonValue[] = [
      { id: "t", type: "text-start" },
      { delta: "Hel", id: "t", type: "text-delta" },
      { delta: "lo", id: "t", type: "text-delta" },
      { id: "t", type: "text-end" },
    ];
    const seqs = await Promise.all(
      chunks.map((chunk) => channel.append(runId, chunk))
    );
    expect(seqs.map((seq) => seq.ok && seq.value)).toEqual([1, 2, 2, 3]);
    // A later batch starts a new row; the stored one never changes.
    expect(
      await channel.append(runId, { delta: "!", id: "t", type: "text-delta" })
    ).toEqual({ ok: true, value: 4 });
    await transitionRun(testDb.db, runId, { type: "succeed" });
    expect((await collect(await channel.subscribe(runId))).slice(0, 4)).toEqual(
      [
        { payload: { id: "t", type: "text-start" }, seq: 1, type: "chunk" },
        {
          payload: { delta: "Hello", id: "t", type: "text-delta" },
          seq: 2,
          type: "chunk",
        },
        { payload: { id: "t", type: "text-end" }, seq: 3, type: "chunk" },
        {
          payload: { delta: "!", id: "t", type: "text-delta" },
          seq: 4,
          type: "chunk",
        },
      ]
    );
    await channel.stop();
  });

  it("renders a long answer the same however a client resumes", async () => {
    const channel = channelFor(listen);
    const runId = await newRun();
    const chunks = longAnswer();
    const expected = await render(chunks);

    // A client following live from the start drops off partway through.
    const writing = pipe(channel, runId, chunks);
    const live = await channel.subscribe(runId);
    if (!live.ok) {
      throw new Error("subscribe failed");
    }
    const seen: { payload: unknown; seq: number }[] = [];
    for await (const event of live.value) {
      if (event.type === "chunk") {
        seen.push(event);
      }
      if (seen.length === 3) {
        break;
      }
    }
    const seqs = await writing;
    await transitionRun(testDb.db, runId, { type: "succeed" });
    await channel.close(runId, "succeeded");

    const all = (await collect(await channel.subscribe(runId))).flatMap(
      (event) => (event.type === "chunk" ? [event] : [])
    );
    expect(all.map((event) => event.seq)).toEqual(
      all.map((_, index) => index + 1)
    );
    expect(all.length).toBeLessThan(chunks.length / 10);
    // Each append resolved with the row now holding its chunk.
    expect(new Set(seqs.map((seq) => seq.ok && seq.value))).toEqual(
      new Set(all.map((event) => event.seq))
    );
    expect(await render(all.map((event) => event.payload))).toEqual(expected);

    const resume = async (cursor: number) =>
      (await collect(await channel.subscribe(runId, { cursor }))).flatMap(
        (event) => (event.type === "chunk" ? [event.payload] : [])
      );
    // The live client resumes after what it saw: nothing missed or repeated.
    const lastSeen = (seen.at(-1) as { seq: number }).seq;
    expect(
      await render([
        ...seen.map((event) => event.payload),
        ...(await resume(lastSeen)),
      ])
    ).toEqual(expected);
    // So does a resume from any other row, or from 0.
    for (const cursor of [0, ...all.map((event) => event.seq)]) {
      const before = all
        .filter((event) => event.seq <= cursor)
        .map((event) => event.payload);
      // biome-ignore lint/performance/noAwaitInLoops: each cursor is its own resume.
      expect(await render([...before, ...(await resume(cursor))])).toEqual(
        expected
      );
    }
    await channel.stop();
  });

  it("refuses to close a run that hasn't finished", async () => {
    const channel = channelFor(listen);
    const runId = await newRun();
    expect((await channel.close(runId, "succeeded")).ok).toBe(false);
    await channel.stop();
  });

  it("stops following when the subscriber aborts", async () => {
    const channel = channelFor(listen);
    const runId = await newRun();
    const controller = new AbortController();
    const subscribed = await channel.subscribe(runId, {
      signal: controller.signal,
    });
    const events = collect(subscribed);
    controller.abort();
    expect(await events).toEqual([]);
    await channel.stop();
  });
});

describe.skipIf(process.env.TEST_DATABASE_URL)("fan-out", () => {
  it("wakes a subscriber in another channel through NOTIFY, not polling", async () => {
    const writer = channelFor(false);
    // Polls only every 5s: anything faster came through LISTEN.
    const reader = channelFor(true);
    const runId = await newRun();
    const subscribed = await reader.subscribe(runId);
    if (!subscribed.ok) {
      throw new Error("subscribe failed");
    }
    const events = subscribed.value[Symbol.asyncIterator]();
    const first = events.next();
    // Let the subscriber find nothing and start waiting.
    await new Promise((resolve) => setTimeout(resolve, 200));
    const started = Date.now();
    await writer.append(runId, { n: 1 });
    expect((await first).value).toEqual({
      payload: { n: 1 },
      seq: 1,
      type: "chunk",
    });
    expect(Date.now() - started).toBeLessThan(2000);
    await events.return?.();
    await reader.stop();
    await writer.stop();
  });
});

describe("cursorFrom", () => {
  const request = (url: string, lastEventId?: string) =>
    new Request(url, {
      headers: lastEventId ? { "last-event-id": lastEventId } : {},
    });

  it("prefers ?cursor=, then Last-Event-ID, else the start", () => {
    expect(cursorFrom(request("http://x/s?cursor=7", "3"))).toBe(7);
    expect(cursorFrom(request("http://x/s", "3"))).toBe(3);
    expect(cursorFrom(request("http://x/s"))).toBe(0);
    expect(cursorFrom(request("http://x/s?cursor=nope"))).toBe(0);
    expect(cursorFrom(request("http://x/s?cursor=-2"))).toBe(0);
  });
});
