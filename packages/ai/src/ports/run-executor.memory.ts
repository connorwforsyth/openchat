import type { JsonValue, RunId } from "@workspace/contract/schemas/common";
import type {
  PendingApproval,
  RunError,
  RunState,
  ToolApproval,
} from "@workspace/contract/schemas/runs";
import { err, ok } from "@workspace/shared/result";

import type {
  RunExecutor,
  RunStart,
  RunStreamWriter,
  TerminalRunStatus,
} from "./run-executor";

// In-memory RunExecutor for tests. A *script* stands in for the model: it
// yields stream chunks, asks for approvals, or fails. The fake runs the
// script detached, like the real executor, and tests wait with `settled`.

export type ScriptStep =
  | { readonly payload: JsonValue; readonly type: "chunk" }
  | {
      readonly approvals: readonly Omit<PendingApproval, "requestedAt">[];
      readonly type: "approvals";
    }
  | { readonly error: RunError; readonly type: "fail" };

export interface ScriptContext {
  /** The decision for a tool call, once an approver has made one. */
  decisionFor: (toolCallId: string) => ToolApproval | undefined;
}

export type RunScript = (
  run: RunStart,
  context: ScriptContext
) => AsyncIterable<ScriptStep> | Iterable<ScriptStep>;

export interface MemoryRunExecutor extends RunExecutor {
  /** Every decision received for a run, in order. */
  decisions: (runId: RunId) => readonly ToolApproval[];
  /** Resolves once the run is terminal or waiting for approval. */
  settled: (runId: RunId) => Promise<RunState>;
}

interface Entry {
  readonly decisions: ToolApproval[];
  resume?: () => void;
  state: RunState;
  readonly waiters: Array<(state: RunState) => void>;
}

const isSettled = (state: RunState): boolean =>
  state.status !== "queued" && state.status !== "running";

const TERMINAL: ReadonlySet<RunState["status"]> = new Set([
  "succeeded",
  "failed",
  "cancelled",
]);

export const createMemoryRunExecutor = ({
  now = () => new Date(),
  script,
  writer,
}: {
  readonly now?: () => Date;
  readonly script: RunScript;
  readonly writer: RunStreamWriter;
}): MemoryRunExecutor => {
  const runs = new Map<RunId, Entry>();
  const timestamp = () => now().toISOString();

  const transition = (entry: Entry, state: RunState) => {
    entry.state = state;
    if (isSettled(state)) {
      for (const waiter of entry.waiters.splice(0)) {
        waiter(state);
      }
    }
  };

  const finish = async (
    runId: RunId,
    entry: Entry,
    state: RunState & { status: TerminalRunStatus }
  ) => {
    transition(entry, state);
    await writer.close(runId, state.status);
  };

  /** Plays one script step; `false` means the run ended and the script stops. */
  const playStep = async (
    run: RunStart,
    entry: Entry,
    step: ScriptStep,
    startedAt: string
  ): Promise<boolean> => {
    switch (step.type) {
      case "chunk": {
        const appended = await writer.append(run.runId, step.payload);
        if (appended.ok) {
          return true;
        }
        await finish(run.runId, entry, {
          error: {
            code: "internal",
            message: "stream closed",
            retryable: false,
          },
          finishedAt: timestamp(),
          startedAt,
          status: "failed",
        });
        return false;
      }
      case "approvals": {
        const requestedAt = timestamp();
        await new Promise<void>((resolve) => {
          entry.resume = resolve;
          transition(entry, {
            approvals: step.approvals.map((a) => ({ ...a, requestedAt })),
            startedAt,
            status: "awaiting_approval",
          });
        });
        entry.resume = undefined;
        if (TERMINAL.has(entry.state.status)) {
          return false; // cancelled while waiting
        }
        transition(entry, { startedAt, status: "running" });
        return true;
      }
      case "fail":
        await finish(run.runId, entry, {
          error: step.error,
          finishedAt: timestamp(),
          startedAt,
          status: "failed",
        });
        return false;
      default:
        return step satisfies never;
    }
  };

  const execute = async (run: RunStart, entry: Entry, startedAt: string) => {
    const context: ScriptContext = {
      decisionFor: (toolCallId) =>
        [...entry.decisions].reverse().find((d) => d.toolCallId === toolCallId),
    };
    // Steps play in order: each one may wait on the one before.
    for await (const step of script(run, context)) {
      if (
        TERMINAL.has(entry.state.status) ||
        !(await playStep(run, entry, step, startedAt))
      ) {
        return;
      }
    }
    if (!TERMINAL.has(entry.state.status)) {
      await finish(run.runId, entry, {
        finishedAt: timestamp(),
        startedAt,
        status: "succeeded",
      });
    }
  };

  return {
    cancel: async (runId, by) => {
      const entry = runs.get(runId);
      if (!entry) {
        return err({ runId, type: "not_found" });
      }
      if (TERMINAL.has(entry.state.status)) {
        return err({
          runId,
          status: entry.state.status,
          type: "invalid_state",
        });
      }
      await finish(runId, entry, {
        cancelledBy: by,
        finishedAt: timestamp(),
        status: "cancelled",
      });
      entry.resume?.();
      return ok(undefined);
    },

    decisions: (runId) => [...(runs.get(runId)?.decisions ?? [])],

    getState: (runId) => {
      const entry = runs.get(runId);
      return Promise.resolve(
        entry ? ok(entry.state) : err({ runId, type: "not_found" as const })
      );
    },

    settled: (runId) => {
      const entry = runs.get(runId);
      if (!entry) {
        return Promise.reject(new Error(`unknown run ${runId}`));
      }
      if (isSettled(entry.state)) {
        return Promise.resolve(entry.state);
      }
      return new Promise((resolve) => entry.waiters.push(resolve));
    },

    start: (run) => {
      if (runs.has(run.runId)) {
        return Promise.resolve(
          err({ runId: run.runId, type: "already_started" as const })
        );
      }
      // The fake has no queue (one run per branch is the real executor's
      // job), so a run starts running as soon as it's accepted.
      const startedAt = timestamp();
      const entry: Entry = {
        decisions: [],
        state: { startedAt, status: "running" },
        waiters: [],
      };
      runs.set(run.runId, entry);
      // Detached on purpose: the caller gets control back at once. A throw in
      // a script is a test bug, so it fails the run instead of vanishing.
      execute(run, entry, startedAt).catch(async (cause: unknown) => {
        await finish(run.runId, entry, {
          error: { code: "internal", message: String(cause), retryable: false },
          finishedAt: timestamp(),
          startedAt,
          status: "failed",
        });
      });
      return Promise.resolve(ok(undefined));
    },

    submitApprovals: (runId, decisions) => {
      const entry = runs.get(runId);
      if (!entry) {
        return Promise.resolve(err({ runId, type: "not_found" as const }));
      }
      const { state } = entry;
      if (state.status !== "awaiting_approval") {
        return Promise.resolve(
          err({ runId, status: state.status, type: "invalid_state" as const })
        );
      }
      const pending = new Set(state.approvals.map((a) => a.toolCallId));
      const unknown = decisions.find((d) => !pending.has(d.toolCallId));
      if (unknown) {
        return Promise.resolve(
          err({
            runId,
            toolCallId: unknown.toolCallId,
            type: "unknown_tool_call" as const,
          })
        );
      }
      entry.decisions.push(...decisions);
      const decided = new Set(entry.decisions.map((d) => d.toolCallId));
      if ([...pending].every((id) => decided.has(id))) {
        entry.resume?.();
      }
      return Promise.resolve(ok(undefined));
    },
  };
};
