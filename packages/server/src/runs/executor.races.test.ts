import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import type {
  RunStreamWriter,
  TerminalRunStatus,
} from "@workspace/ai/ports/run-executor";
import {
  textStream,
  toolCallStream,
  usage,
} from "@workspace/ai/testing/mock-models";
import type { RunId } from "@workspace/contract/schemas/common";
import type { Db } from "@workspace/db/client";
import { createConversation } from "@workspace/db/queries/conversations";
import { insertMessage } from "@workspace/db/queries/messages";
import {
  createRun,
  getRun,
  type RunRow,
  readRunChunks,
} from "@workspace/db/queries/runs";
import {
  createTestDb,
  expectOk,
  seedOrg,
  seedUser,
  type TestDb,
} from "@workspace/db/testing";
import { ok } from "@workspace/shared/result";
import { tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createPostgresStreamChannel } from "../stream/postgres-stream-channel";
import { createInProcessExecutor } from "./executor";
import { runStartFromRow } from "./state";
import type { Turn } from "./turn";

// The races the run-queue model found (.claude/skills/verify-run-queue).
// Each test holds requests at the awaits its counterexample names, so every
// run takes that interleaving. Nothing here reaches a provider.

type Point = "append" | "getRun" | "requeueAfter" | "transaction";

const holds = vi.hoisted(() => {
  const waiting = new Map<string, (() => Promise<void>)[]>();
  const executorDbs = new WeakSet<object>();
  return {
    /** Marks the executor's database, so only its reads stop at `getRun`. */
    executorDb: <T extends object>(db: T): T => {
      executorDbs.add(db);
      return db;
    },
    isExecutorDb: (db: unknown) =>
      typeof db === "object" && db !== null && executorDbs.has(db),
    /** Holds the next request to reach `point` until the test releases it. */
    next: (point: Point) => {
      let arrive: () => void = () => undefined;
      let release: () => void = () => undefined;
      const reached = new Promise<void>((resolve) => {
        arrive = resolve;
      });
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      waiting.set(point, [
        ...(waiting.get(point) ?? []),
        () => {
          arrive();
          return released;
        },
      ]);
      return { reached, release };
    },
    /** Where a request passes `point`, waiting there if the test holds it. */
    pass: async (point: Point) => {
      const [hold, ...rest] = waiting.get(point) ?? [];
      waiting.set(point, rest);
      await hold?.();
    },
    /** Drops holds a failed test never reached, so they can't catch the next test. */
    reset: () => waiting.clear(),
  };
});

vi.mock("@workspace/db/queries/runs", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@workspace/db/queries/runs")>();
  return {
    ...actual,
    getRun: async (
      ...args: Parameters<typeof actual.getRun>
    ): ReturnType<typeof actual.getRun> => {
      if (holds.isExecutorDb(args[0])) {
        await holds.pass("getRun");
      }
      return actual.getRun(...args);
    },
    requeueAfter: async (
      ...args: Parameters<typeof actual.requeueAfter>
    ): ReturnType<typeof actual.requeueAfter> => {
      await holds.pass("requeueAfter");
      return actual.requeueAfter(...args);
    },
  };
});

/** The executor's database: each transaction passes `transaction` before it begins. */
const holdingTransactions = (db: Db): Db =>
  holds.executorDb(
    new Proxy(db, {
      get: (target, key) => {
        if (key === "transaction") {
          return async (...args: Parameters<Db["transaction"]>) => {
            await holds.pass("transaction");
            return target.transaction(...args);
          };
        }
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    })
  );

/** A model whose answer stays open until `finish()`, noting the signal its call got. */
const openModel = () => {
  let signal: AbortSignal | undefined;
  let sink: ReadableStreamDefaultController<LanguageModelV4StreamPart> | null =
    null;
  let called: () => void = () => undefined;
  const answering = new Promise<void>((resolve) => {
    called = resolve;
  });
  const model = new MockLanguageModelV4({
    doStream: (options) => {
      signal = options.abortSignal;
      called();
      return Promise.resolve({
        stream: new ReadableStream<LanguageModelV4StreamPart>({
          cancel: () => {
            sink = null;
          },
          start: (controller) => {
            sink = controller;
            controller.enqueue({ type: "stream-start", warnings: [] });
            controller.enqueue({ id: "t1", type: "text-start" });
            controller.enqueue({
              delta: "Working",
              id: "t1",
              type: "text-delta",
            });
          },
        }),
      });
    },
  });
  return {
    answering,
    /** Ends the answer, unless the call was cancelled. */
    finish: () => {
      sink?.enqueue({ id: "t1", type: "text-end" });
      sink?.enqueue({
        finishReason: { raw: "stop", unified: "stop" },
        type: "finish",
        usage: usage(),
      });
      sink?.close();
      sink = null;
    },
    model,
    signal: () => signal,
  };
};

const turnWith = (model: Turn["model"], extra: Partial<Turn> = {}): Turn => ({
  agent: null,
  model,
  paidBy: null,
  resolvedModel: "test:model",
  ...extra,
});

/** A turn asking to write a file, which needs approval, then the turn after the decision. */
const writeTurns = () => {
  const execute = vi.fn(() => "written");
  const after = new MockLanguageModelV4({ doStream: textStream("Done.") });
  const extra = {
    toolApproval: { write_file: "user-approval" },
    tools: {
      write_file: tool({
        execute,
        inputSchema: z.object({ path: z.string() }),
      }),
    },
  } as const;
  return {
    after,
    execute,
    turns: [
      turnWith(
        new MockLanguageModelV4({
          doStream: toolCallStream("write_file", { path: "a.txt" }, "call-a"),
        }),
        extra
      ),
      turnWith(after, extra),
    ],
  };
};

const approveA = [
  { decision: { decision: "approve" }, toolCallId: "call-a" },
] as const;

let testDb: TestDb | null = null;
const openModels: ReturnType<typeof openModel>[] = [];

afterEach(async () => {
  holds.reset();
  for (const open of openModels.splice(0)) {
    open.finish();
  }
  await testDb?.close();
  testDb = null;
});

const setup = async () => {
  testDb = await createTestDb();
  const { db } = testDb;
  const owner = await seedUser(db);
  const org = await seedOrg(db, owner.id, { isPersonal: true });
  const context = { id: org.id, type: "personal" } as const;
  const chat = await createConversation(db, { context, ownerId: owner.id });
  const turns: Turn[] = [];
  const settled: RunId[] = [];
  const channel = createPostgresStreamChannel({ db });
  const appended: unknown[] = [];
  const stream: { down: boolean; failures: number } = {
    down: false,
    failures: 0,
  };
  const writer: RunStreamWriter = {
    append: async (runId, payload) => {
      appended.push(payload);
      await holds.pass("append");
      if (stream.down || stream.failures > 0) {
        stream.failures = Math.max(0, stream.failures - 1);
        throw new Error("the stream is down");
      }
      return channel.append(runId, payload);
    },
    close: (runId, status: TerminalRunStatus) => channel.close(runId, status),
  };
  const executor = createInProcessExecutor({
    db: holdingTransactions(db),
    onSettled: (event) => {
      settled.push(event.run.id);
      return Promise.resolve();
    },
    resolveTurn: () => {
      const turn = turns.shift();
      if (!turn) {
        throw new Error("no turn scripted for this pass");
      }
      return Promise.resolve(ok(turn));
    },
    writer,
  });
  /** A new turn's question and its run, queued behind `after` when given. */
  const queue = async (after: RunRow | null = null): Promise<RunRow> => {
    const question = expectOk(
      await insertMessage(db, {
        authorId: owner.id,
        conversationId: chat.id,
        parentId: after?.userMessageId ?? null,
        parts: [{ text: "go", type: "text" }],
        role: "user",
      })
    );
    const created = await createRun(db, {
      afterRunId: after?.id ?? null,
      context,
      conversationId: chat.id,
      createdBy: owner.id,
      target: { model: "test:model", type: "model" },
      userMessageId: question.id,
    });
    return created.run;
  };
  return {
    /** Every chunk handed to the stream, held or not. */
    appended,
    /** The run's stream as a client replays it. */
    chunksOf: async (run: RunRow) =>
      (await readRunChunks(db, run.id)).map((chunk) => chunk.payload),
    executor,
    /** Scripts a pass that answers until the test finishes it. */
    open: () => {
      const open = openModel();
      openModels.push(open);
      turns.push(turnWith(open.model));
      return open;
    },
    ownerId: owner.id,
    queue,
    settled,
    start: (run: RunRow) => executor.start(runStartFromRow(run)),
    statusOf: async (run: RunRow) => expectOk(await getRun(db, run.id)).status,
    /** Writes to the stream throw while it's down, and for the next `failures` writes. */
    stream,
    turns,
  };
};

describe("a run started twice at once", () => {
  it("still stops: Stop reaches the pass that won the claim", async () => {
    const chat = await setup();
    const ahead = await chat.queue();
    const open = chat.open();
    await chat.start(ahead);
    await open.answering;
    open.finish();
    await chat.executor.idle();
    // A turn sent just as the answer ahead finished: its own createRun and
    // the finished run's promoteAfter both start it.
    const run = await chat.queue(ahead);
    const answer = chat.open();
    const first = holds.next("transaction");
    const second = holds.next("transaction");
    const starts = [chat.start(run), chat.start(run)];
    await Promise.all([first.reached, second.reached]);
    first.release();
    await answer.answering;
    second.release();
    await Promise.all(starts);

    expect(await chat.executor.cancel(run.id, chat.ownerId)).toEqual(
      ok(undefined)
    );
    expect(answer.signal()?.aborted).toBe(true);
    await chat.executor.idle();
    expect(await chat.statusOf(run)).toBe("cancelled");
  });

  it("still resumes when the losing start lands after a decision", async () => {
    const chat = await setup();
    const ahead = await chat.queue();
    const open = chat.open();
    await chat.start(ahead);
    await open.answering;
    open.finish();
    await chat.executor.idle();
    const run = await chat.queue(ahead);
    const { execute, turns } = writeTurns();
    chat.turns.push(...turns);
    const first = holds.next("transaction");
    const late = holds.next("transaction");
    const starts = [chat.start(run), chat.start(run)];
    await Promise.all([first.reached, late.reached]);
    first.release();
    await vi.waitFor(async () =>
      expect(await chat.statusOf(run)).toBe("awaiting_approval")
    );
    await chat.executor.idle();

    const announcing = holds.next("append");
    const deciding = chat.executor.submitApprovals(
      run.id,
      approveA,
      chat.ownerId
    );
    await announcing.reached;
    late.release();
    await Promise.all(starts);
    announcing.release();
    expect(await deciding).toEqual(ok(undefined));
    await chat.executor.idle();

    expect(execute).toHaveBeenCalledOnce();
    expect(await chat.statusOf(run)).toBe("succeeded");
  });
});

describe("Stop on a run that is starting", () => {
  it("stops the pass that claimed it, and settles the run once", async () => {
    const chat = await setup();
    const run = await chat.queue();
    const answer = chat.open();
    // Stop reads the run queued with nothing executing it, then the run is
    // claimed before Stop's cancel commits.
    const cancelling = holds.next("transaction");
    const stopping = chat.executor.cancel(run.id, chat.ownerId);
    await cancelling.reached;
    await chat.start(run);
    await answer.answering;
    cancelling.release();
    expect(await stopping).toEqual(ok(undefined));

    expect(answer.signal()?.aborted).toBe(true);
    answer.finish();
    await chat.executor.idle();
    expect(await chat.statusOf(run)).toBe("cancelled");
    expect(chat.settled.filter((id) => id === run.id)).toHaveLength(1);
  });
});

describe("Stop on the approval card as a decision lands", () => {
  it("runs nothing after Stop: not the approved call, not the model", async () => {
    const chat = await setup();
    const run = await chat.queue();
    const { after, execute, turns } = writeTurns();
    chat.turns.push(...turns);
    await chat.start(run);
    await chat.executor.idle();
    expect(await chat.statusOf(run)).toBe("awaiting_approval");

    // Stop reads the run waiting on the card; the decision resumes it before
    // Stop's cancel commits, and starts its pass after.
    const cancelling = holds.next("transaction");
    const stopping = chat.executor.cancel(run.id, chat.ownerId);
    await cancelling.reached;
    const announcing = holds.next("append");
    const deciding = chat.executor.submitApprovals(
      run.id,
      approveA,
      chat.ownerId
    );
    await announcing.reached;
    cancelling.release();
    expect(await stopping).toEqual(ok(undefined));
    announcing.release();
    await deciding;
    await chat.executor.idle();

    expect(execute).not.toHaveBeenCalled();
    expect(after.doStreamCalls).toHaveLength(0);
    expect(await chat.statusOf(run)).toBe("cancelled");
    expect(chat.settled.filter((id) => id === run.id)).toHaveLength(1);
  });
});

describe("Stop on a queued turn", () => {
  it("never strands the turn queued behind it", async () => {
    const chat = await setup();
    const first = await chat.queue();
    const answer = chat.open();
    await chat.start(first);
    await answer.answering;
    const stopped = await chat.queue(first);
    const last = await chat.queue(stopped);
    chat.turns.push(
      turnWith(new MockLanguageModelV4({ doStream: textStream("Hi.") }))
    );

    // The answer ahead finishes, finding nothing behind it, before Stop moves
    // the last turn to wait on it.
    const requeueing = holds.next("requeueAfter");
    const stopping = chat.executor.cancel(stopped.id, chat.ownerId);
    await requeueing.reached;
    answer.finish();
    await chat.executor.idle();
    expect(await chat.statusOf(first)).toBe("succeeded");
    requeueing.release();
    expect(await stopping).toEqual(ok(undefined));
    await chat.executor.idle();

    expect(await chat.statusOf(stopped)).toBe("cancelled");
    expect(await chat.statusOf(last)).toBe("succeeded");
  });
});

describe("Stop as the pass pauses for approval", () => {
  it("stops the pass a decision resumes right after", async () => {
    const chat = await setup();
    const run = await chat.queue();
    const { after, execute, turns } = writeTurns();
    chat.turns.push(...turns);
    // The pass has shown the card and is still settling when Stop aborts
    // it; it pauses anyway, and a decision resumes it before Stop looks again.
    const streaming = holds.next("append");
    await chat.start(run);
    await streaming.reached;
    await vi.waitFor(() =>
      expect(chat.appended).toContainEqual(
        expect.objectContaining({ type: "finish" })
      )
    );
    const stopping = chat.executor.cancel(run.id, chat.ownerId);
    const lookingAgain = holds.next("getRun");
    streaming.release();
    await lookingAgain.reached;
    expect(await chat.statusOf(run)).toBe("awaiting_approval");
    const announcing = holds.next("append");
    const deciding = chat.executor.submitApprovals(
      run.id,
      approveA,
      chat.ownerId
    );
    await announcing.reached;
    lookingAgain.release();
    expect(await stopping).toEqual(ok(undefined));
    announcing.release();
    await deciding;
    await chat.executor.idle();

    expect(execute).not.toHaveBeenCalled();
    expect(after.doStreamCalls).toHaveLength(0);
    expect(await chat.statusOf(run)).toBe("cancelled");
  });
});

describe("Stop on the approval card as a decision lands, then the pass pauses again", () => {
  it("still stops the run", async () => {
    const chat = await setup();
    const run = await chat.queue();
    const execute = vi.fn(() => "written");
    const extra = {
      toolApproval: { write_file: "user-approval" },
      tools: {
        write_file: tool({
          execute,
          inputSchema: z.object({ path: z.string() }),
        }),
      },
    } as const;
    const again = new MockLanguageModelV4({
      doStream: toolCallStream("write_file", { path: "b.txt" }, "call-b"),
    });
    chat.turns.push(
      turnWith(
        new MockLanguageModelV4({
          doStream: toolCallStream("write_file", { path: "a.txt" }, "call-a"),
        }),
        extra
      ),
      turnWith(again, extra)
    );
    await chat.start(run);
    await chat.executor.idle();

    // Stop reads the run waiting on the card. The decision commits before
    // Stop's cancel, and the pass it resumes asks about another call; Stop
    // aborts that pass as it settles, and it pauses anyway.
    const cancelling = holds.next("transaction");
    const stopping = chat.executor.cancel(run.id, chat.ownerId);
    await cancelling.reached;
    expect(
      await chat.executor.submitApprovals(run.id, approveA, chat.ownerId)
    ).toEqual(ok(undefined));
    const streaming = holds.next("append");
    await streaming.reached;
    await vi.waitFor(() =>
      expect(
        chat.appended.filter(
          (chunk) =>
            typeof chunk === "object" &&
            chunk !== null &&
            "type" in chunk &&
            chunk.type === "finish"
        )
      ).toHaveLength(2)
    );
    cancelling.release();
    await vi.waitFor(() =>
      expect(again.doStreamCalls[0]?.abortSignal?.aborted).toBe(true)
    );
    streaming.release();
    expect(await stopping).toEqual(ok(undefined));
    await chat.executor.idle();

    expect(execute).toHaveBeenCalledOnce();
    expect(await chat.statusOf(run)).toBe("cancelled");
  });
});

describe("Stop on the approval card as a decision lands, on the stream", () => {
  it("never shows the card stopped ahead of the decision that beat Stop", async () => {
    const chat = await setup();
    const run = await chat.queue();
    const { turns } = writeTurns();
    chat.turns.push(...turns);
    await chat.start(run);
    await chat.executor.idle();

    const cancelling = holds.next("transaction");
    const stopping = chat.executor.cancel(run.id, chat.ownerId);
    await cancelling.reached;
    const announcing = holds.next("append");
    const deciding = chat.executor.submitApprovals(
      run.id,
      approveA,
      chat.ownerId
    );
    await announcing.reached;
    cancelling.release();
    await stopping;
    announcing.release();
    await deciding;
    await chat.executor.idle();

    const chunks = await chat.chunksOf(run);
    const decided = chunks.findIndex(
      (chunk) =>
        typeof chunk === "object" &&
        chunk !== null &&
        "type" in chunk &&
        chunk.type === "tool-approval-response"
    );
    expect(decided).toBeGreaterThan(-1);
    expect(chunks.slice(0, decided)).not.toContainEqual(
      expect.objectContaining({
        toolCallId: "call-a",
        type: "tool-output-error",
      })
    );
  });
});

describe("Stop on a run whose pass crashed", () => {
  it("ends the run and starts the turn queued behind it", async () => {
    const chat = await setup();
    const run = await chat.queue();
    const next = await chat.queue(run);
    // No turn is scripted, so the pass throws; with the stream down,
    // failing the run throws too, and the run is left running.
    chat.stream.down = true;
    await chat.start(run);
    await chat.executor.idle();
    chat.stream.down = false;
    expect(await chat.statusOf(run)).toBe("running");
    await chat.start(next);
    chat.turns.push(
      turnWith(new MockLanguageModelV4({ doStream: textStream("Hi.") }))
    );

    expect(await chat.executor.cancel(run.id, chat.ownerId)).toEqual(
      ok(undefined)
    );
    await chat.executor.idle();
    expect(await chat.statusOf(run)).toBe("cancelled");
    expect(chat.settled.filter((id) => id === run.id)).toHaveLength(1);
    expect(await chat.statusOf(next)).toBe("succeeded");
  });
});

describe("A decision whose announcement throws", () => {
  it("fails the run and starts the turn queued behind it", async () => {
    const chat = await setup();
    const run = await chat.queue();
    const next = await chat.queue(run);
    const { execute, turns } = writeTurns();
    chat.turns.push(...turns);
    await chat.start(run);
    await chat.executor.idle();
    expect(await chat.statusOf(run)).toBe("awaiting_approval");

    // The decision commits and resumes the run; announcing it then throws,
    // before its pass starts.
    chat.stream.failures = 1;
    await expect(
      chat.executor.submitApprovals(run.id, approveA, chat.ownerId)
    ).rejects.toThrow();
    await chat.executor.idle();

    expect(execute).not.toHaveBeenCalled();
    expect(await chat.statusOf(run)).toBe("failed");
    expect(await chat.statusOf(next)).toBe("succeeded");
  });
});
