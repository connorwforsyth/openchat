import { fixtureId } from "@workspace/contract/fixtures";
import type { JsonValue, RunId } from "@workspace/contract/schemas/common";
import { err, ok } from "@workspace/shared/result";
import { describe, expect, it } from "vitest";

import type {
  RunStart,
  RunStreamWriter,
  TerminalRunStatus,
} from "./run-executor";
import { runStartSchema } from "./run-executor";
import {
  createMemoryRunExecutor,
  type RunScript,
  type ScriptStep,
} from "./run-executor.memory";

const recordingWriter = () => {
  const chunks: JsonValue[] = [];
  const closed: TerminalRunStatus[] = [];
  const writer: RunStreamWriter = {
    append: (_runId, payload) => {
      if (closed.length > 0) {
        return Promise.resolve(err({ runId: _runId, type: "closed" as const }));
      }
      chunks.push(payload);
      return Promise.resolve(ok(chunks.length));
    },
    close: (_runId, status) => {
      closed.push(status);
      return Promise.resolve(ok(undefined));
    },
  };
  return { chunks, closed, writer };
};

const run = (n = 1): RunStart =>
  runStartSchema.parse({
    context: { type: "personal" },
    conversationId: fixtureId("conversation", 1),
    createdBy: fixtureId("user", 1),
    runId: fixtureId("run", n),
    target: { model: "fast", type: "model" },
    userMessageId: fixtureId("message", 1),
  });

const text = (delta: string) => ({ delta, id: "t", type: "text-delta" });
const clock = () => new Date("2026-09-26T09:00:00.000Z");

describe("memory RunExecutor", () => {
  it("parses a run start with default options", () => {
    expect(run().options).toEqual({ sandbox: "auto", webSearch: "auto" });
  });

  it("streams chunks and succeeds, detached from start", async () => {
    const { chunks, closed, writer } = recordingWriter();
    const executor = createMemoryRunExecutor({
      now: clock,
      *script() {
        yield { payload: text("Hel"), type: "chunk" };
        yield { payload: text("lo"), type: "chunk" };
      },
      writer,
    });
    expect(await executor.start(run())).toEqual(ok(undefined));
    const state = await executor.settled(run().runId);
    expect(state.status).toBe("succeeded");
    expect(chunks).toEqual([text("Hel"), text("lo")]);
    expect(closed).toEqual(["succeeded"]);
  });

  it("refuses to start the same run twice", async () => {
    const executor = createMemoryRunExecutor({
      script: () => [],
      writer: recordingWriter().writer,
    });
    await executor.start(run());
    expect(await executor.start(run())).toEqual(
      err({ runId: run().runId, type: "already_started" })
    );
  });

  it("pauses for approval and resumes once every call is decided", async () => {
    const { closed, writer } = recordingWriter();
    const seen: string[] = [];
    const script: RunScript = function* (_run, context): Generator<ScriptStep> {
      yield {
        approvals: [
          { input: { path: "a.ts" }, toolCallId: "c1", toolName: "edit" },
          { input: { cmd: "ls" }, toolCallId: "c2", toolName: "bash" },
        ],
        type: "approvals",
      };
      seen.push(context.decisionFor("c1")?.decision.decision ?? "none");
      seen.push(context.decisionFor("c2")?.decision.decision ?? "none");
      yield { payload: text("done"), type: "chunk" };
    };
    const executor = createMemoryRunExecutor({ now: clock, script, writer });
    const { runId } = run();
    await executor.start(run());

    const waiting = await executor.settled(runId);
    expect(waiting).toMatchObject({ status: "awaiting_approval" });
    expect(
      waiting.status === "awaiting_approval" &&
        waiting.approvals.map((a) => a.toolCallId)
    ).toEqual(["c1", "c2"]);

    const by = fixtureId("user", 2);
    await executor.submitApprovals(
      runId,
      [{ decision: { decision: "approve" }, toolCallId: "c1" }],
      by
    );
    expect(
      (await executor.getState(runId)).ok && (await executor.getState(runId))
    ).toMatchObject({
      value: { status: "awaiting_approval" },
    });

    await executor.submitApprovals(
      runId,
      [
        {
          decision: {
            comments: [],
            decision: "review",
            hunks: [{ decision: "reject", hunkId: "h1" }],
          },
          toolCallId: "c2",
        },
      ],
      by
    );
    expect((await executor.settled(runId)).status).toBe("succeeded");
    expect(seen).toEqual(["approve", "review"]);
    expect(executor.decisions(runId)).toHaveLength(2);
    expect(closed).toEqual(["succeeded"]);
  });

  it("rejects decisions for unknown calls or runs that aren't waiting", async () => {
    const executor = createMemoryRunExecutor({
      *script() {
        yield {
          approvals: [{ input: null, toolCallId: "c1", toolName: "bash" }],
          type: "approvals",
        };
      },
      writer: recordingWriter().writer,
    });
    const { runId } = run();
    const by = fixtureId("user", 1);
    const approve = {
      decision: { decision: "approve" as const },
      toolCallId: "c9",
    };
    expect(await executor.submitApprovals(runId, [approve], by)).toEqual(
      err({ runId, type: "not_found" })
    );
    await executor.start(run());
    await executor.settled(runId);
    expect(await executor.submitApprovals(runId, [approve], by)).toEqual(
      err({ runId, toolCallId: "c9", type: "unknown_tool_call" })
    );
    await executor.cancel(runId, by);
    expect(
      await executor.submitApprovals(
        runId,
        [{ ...approve, toolCallId: "c1" }],
        by
      )
    ).toEqual(err({ runId, status: "cancelled", type: "invalid_state" }));
  });

  it("cancels a waiting run and closes its stream once", async () => {
    const { closed, writer } = recordingWriter();
    const executor = createMemoryRunExecutor({
      now: clock,
      *script() {
        yield {
          approvals: [{ input: null, toolCallId: "c1", toolName: "bash" }],
          type: "approvals",
        };
        yield { payload: text("never"), type: "chunk" };
      },
      writer,
    });
    const { runId } = run();
    await executor.start(run());
    await executor.settled(runId);
    const by = fixtureId("user", 1);
    expect(await executor.cancel(runId, by)).toEqual(ok(undefined));
    expect(await executor.getState(runId)).toEqual(
      ok({
        cancelledBy: by,
        finishedAt: clock().toISOString(),
        status: "cancelled",
      })
    );
    expect(await executor.cancel(runId, by)).toEqual(
      err({ runId, status: "cancelled", type: "invalid_state" })
    );
    await Promise.resolve();
    expect(closed).toEqual(["cancelled"]);
  });

  it("fails the run when the script says so or throws", async () => {
    const failing = createMemoryRunExecutor({
      *script() {
        yield {
          error: {
            code: "provider_unavailable",
            message: "No key",
            retryable: false,
          },
          type: "fail",
        };
      },
      writer: recordingWriter().writer,
    });
    await failing.start(run(1));
    expect(await failing.settled(run(1).runId)).toMatchObject({
      error: { code: "provider_unavailable" },
      status: "failed",
    });

    const throwing = createMemoryRunExecutor({
      script: () => {
        throw new Error("bug in script");
      },
      writer: recordingWriter().writer,
    });
    await throwing.start(run(2));
    expect(await throwing.settled(run(2).runId)).toMatchObject({
      error: {
        code: "internal",
        message: expect.stringContaining("bug in script"),
      },
      status: "failed",
    });
  });

  it("reports unknown runs", async () => {
    const executor = createMemoryRunExecutor({
      script: () => [],
      writer: recordingWriter().writer,
    });
    const runId: RunId = fixtureId("run", 99);
    expect(await executor.getState(runId)).toEqual(
      err({ runId, type: "not_found" })
    );
    expect(await executor.cancel(runId, null)).toEqual(
      err({ runId, type: "not_found" })
    );
    await expect(executor.settled(runId)).rejects.toThrow("unknown run");
  });
});
