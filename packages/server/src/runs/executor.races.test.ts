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
import { createRun, getRun, type RunRow } from "@workspace/db/queries/runs";
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

type Point = "append" | "transaction";

const holds = vi.hoisted(() => {
  const waiting = new Map<string, (() => Promise<void>)[]>();
  return {
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

/** The executor's database: each transaction passes `transaction` before it begins. */
const holdingTransactions = (db: Db): Db =>
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
  });

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
  const writer: RunStreamWriter = {
    append: async (runId, payload) => {
      await holds.pass("append");
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
