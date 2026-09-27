import { type AgentOutcome, runAgent } from "@workspace/ai/agent/run-agent";
import {
  fromUIMessage,
  type RecordedDecision,
} from "@workspace/ai/messages/from-ui";
import { toUIMessages } from "@workspace/ai/messages/to-ui";
import type {
  RunExecutor,
  RunExecutorError,
  RunStart,
  RunStreamWriter,
  TerminalRunStatus,
} from "@workspace/ai/ports/run-executor";
import { toolSources } from "@workspace/ai/rag/sources";
import type {
  FileId,
  JsonValue,
  MessageId,
  RunId,
  UserId,
} from "@workspace/contract/schemas/common";
import type { DeciderState } from "@workspace/contract/schemas/decider";
import type { MessagePart } from "@workspace/contract/schemas/message-parts";
import type { Message } from "@workspace/contract/schemas/messages";
import type { TokenUsage } from "@workspace/contract/schemas/models";
import type {
  PendingApproval,
  ProposedEdit,
  RunError,
  ToolApproval,
} from "@workspace/contract/schemas/runs";
import type { Db } from "@workspace/db/client";
import {
  getBranchPath,
  getMessage,
  insertMessage,
  toMessage,
  updateMessage,
} from "@workspace/db/queries/messages";
import {
  getRun,
  listActiveRuns,
  listQueuedAfter,
  listRunsWithStatus,
  type RunRow,
  type RunTransition,
  requeueAfter,
  setRunResolvedModel,
  transitionRun,
} from "@workspace/db/queries/runs";
import { newId } from "@workspace/shared/ids";
import { err, ok, type Result } from "@workspace/shared/result";
import { readUIMessageStream, type UIMessage, type UIMessageChunk } from "ai";
import { TransactionRollbackError } from "drizzle-orm";

import type { ToolReview, ToolReviews } from "./sandbox";
import {
  isTerminal,
  queuePosition,
  runStartFromRow,
  runStateFromRow,
} from "./state";
import type { Turn, TurnResolver } from "./turn";

// The in-process RunExecutor (D4, PLAN.md §8 "Chat run"). The run row is the
// source of truth; this process only remembers which runs it is executing, so
// it can abort them. A run:
//
// 1. is claimed (`queued` → `running`) with its assistant message inserted
//    empty, so the branch shows the answer being written;
// 2. loads its branch, resolves the model, keys and tools (`TurnResolver`);
// 3. runs `runAgent`, appending every UI message chunk to the stream;
// 4. stores the answer as our `MessagePart`s and settles: `succeeded`,
//    `failed`, `cancelled`, or `awaiting_approval` until every pending tool
//    call has a decision, when step 2 runs again on the same message;
// 5. once terminal, closes the stream and starts the run queued behind it
//    (one run per branch, D25).
//
// Everything after `start` returns happens detached from the request.

export interface RunSettled {
  readonly run: RunRow;
  readonly status: TerminalRunStatus;
  readonly turn: Pick<Turn, "paidBy" | "resolvedModel"> | null;
  /** The model call's usage, for recording (`null` when nothing was called). */
  readonly usage: TokenUsage | null;
}

export interface InProcessExecutorDeps {
  readonly db: Db;
  /** Where the answer's `file` parts point clients (and providers) for uploads. */
  readonly fileUrl?: (fileId: FileId) => string;
  /** Hard stop for runaway loops. */
  readonly maxSteps?: number;
  readonly now?: () => Date;
  /** Told once per terminal run: usage, jobs (titles, pruning). Must not throw. */
  readonly onSettled?: (event: RunSettled) => Promise<void>;
  /** Unexpected failures, for logs. Never includes secrets. */
  readonly report?: (message: string, cause: unknown) => void;
  readonly resolveTurn: TurnResolver;
  /** Wall clock for one pass of the agent loop (`limits.runTimeoutSeconds`). */
  readonly timeoutMs?: number;
  readonly writer: RunStreamWriter;
}

export interface InProcessExecutor extends RunExecutor {
  /** Resolves once no run is executing in this process (tests, shutdown). */
  readonly idle: () => Promise<void>;
  /**
   * Boot-time recovery (014): runs a crash left `running` fail as
   * interrupted, and queued runs whose turn came while nothing was running
   * start. Call once, before serving, while this is the only executor.
   * Returns how many runs it failed.
   */
  readonly recover: () => Promise<number>;
  /** Aborts every run executing here; they settle as `cancelled`. */
  readonly shutdown: () => Promise<void>;
}

/** How long a cancelled run waits for the agent to report before giving up on it. */
const OUTCOME_GRACE_MS = 1000;

const INTERNAL: RunError = {
  code: "internal",
  message: "Something went wrong while answering.",
  retryable: true,
};

const INTERRUPTED: RunError = {
  code: "internal",
  message: "The server restarted while answering. Try again.",
  retryable: true,
};

const toJson = (chunk: UIMessageChunk): JsonValue =>
  JSON.parse(JSON.stringify(chunk)) as JsonValue;

const deciderState = (messages: readonly Message[]): DeciderState => {
  const turns = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role as "assistant" | "user",
      text: message.parts
        .flatMap((part) => (part.type === "text" ? [part.text] : []))
        .join("\n")
        .slice(0, 20_000),
    }));
  const last = turns.at(-1);
  return {
    facts: {},
    history: turns.slice(-51, -1),
    input: last?.role === "user" ? last.text : "",
  };
};

/** Proposed edits per paused call, as `PendingApproval.edits` carries them. */
type EditsByCall = ReadonlyMap<string, readonly ProposedEdit[]>;

/**
 * What each paused `write`/`edit` would change, so the reviewer sees the
 * patch and decides per hunk (D16). A proposal that can't be made (the file
 * is gone, the edit doesn't match) leaves the call with approve/reject only;
 * running it then reports why.
 */
const proposedEdits = async (
  outcome: AgentOutcome,
  turn: Turn
): Promise<EditsByCall> => {
  const { proposeEdits } = turn;
  if (outcome.status !== "awaiting_approval" || !proposeEdits) {
    return new Map();
  }
  const proposed = await Promise.all(
    outcome.approvals.map(
      async (call) =>
        [
          call.toolCallId,
          await proposeEdits(call).catch(() => undefined),
        ] as const
    )
  );
  return new Map(
    proposed.flatMap(([id, edits]) =>
      edits && edits.length > 0 ? [[id, edits] as const] : []
    )
  );
};

/**
 * The reviews a resumed pass executes with: each pending call's decision
 * and the patch it was made on, which the sandbox tools apply per hunk.
 */
const reviewsFor = (
  pending: readonly PendingApproval[],
  decided: ReadonlyMap<string, RecordedDecision>
): ToolReviews =>
  new Map(
    pending.flatMap((approval) => {
      const decision = decided.get(approval.toolCallId);
      if (!decision) {
        return [];
      }
      const review: ToolReview = approval.edits
        ? { decision: decision.decision, edits: approval.edits }
        : { decision: decision.decision };
      return [[approval.toolCallId, review] as const];
    })
  );

/** Decisions already recorded on the answer's tool calls. */
const recordedDecisions = (
  parts: readonly MessagePart[]
): ReadonlyMap<string, RecordedDecision> =>
  new Map(
    parts.flatMap((part) =>
      part.type === "tool-call" && part.approval.state === "decided"
        ? [
            [
              part.toolCallId,
              {
                decidedAt: part.approval.decidedAt,
                decidedBy: part.approval.decidedBy,
                decision: part.approval.decision,
              },
            ] as const,
          ]
        : []
    )
  );

/**
 * The answer's parts with each retrieval tool's citations (`toolSources`)
 * stored as `source` parts right after its result, where the UI renders
 * them, also after a reload. A resumed answer already carries the earlier
 * ones, so ids seen before aren't added twice.
 */
export const withCitations = (parts: readonly MessagePart[]): MessagePart[] => {
  const seen = new Set(
    parts.flatMap((part) => (part.type === "source" ? [part.id] : []))
  );
  return parts.flatMap((part) => {
    if (part.type !== "tool-result" || part.output.status !== "success") {
      return [part];
    }
    const cited = toolSources(part.output.value).filter(
      (source) => !seen.has(source.id)
    );
    for (const source of cited) {
      seen.add(source.id);
    }
    return [part, ...cited];
  });
};

export const createInProcessExecutor = (
  deps: InProcessExecutorDeps
): InProcessExecutor => {
  const { db, writer } = deps;
  const now = deps.now ?? (() => new Date());
  const fileUrl = deps.fileUrl ?? ((id: FileId) => `/api/files/${id}/content`);
  const report = deps.report ?? (() => undefined);
  /** Runs executing in this process. */
  const active = new Map<RunId, AbortController>();
  /** Each executing pass, by run, so a cancel can wait for it to settle. */
  const running = new Map<RunId, Promise<void>>();
  /** Who cancelled a run this process is executing, for its final state. */
  const cancelledBy = new Map<RunId, UserId | null>();

  const track = (runId: RunId, work: Promise<void>) => {
    const tracked = work
      .catch((cause: unknown) => report("run execution crashed", cause))
      .finally(() => {
        if (running.get(runId) === tracked) {
          running.delete(runId);
        }
      });
    running.set(runId, tracked);
  };

  const transition = async (runId: RunId, change: RunTransition) => {
    const moved = await transitionRun(db, runId, change, now());
    return moved.ok ? moved.value : null;
  };

  /** Starts whatever waited on a run that just ended. */
  const promoteAfter = async (runId: RunId): Promise<void> => {
    const queued = await listQueuedAfter(db, runId);
    for (const next of queued) {
      // biome-ignore lint/performance/noAwaitInLoops: one run per branch; normally there's only one.
      const started = await startRun(runStartFromRow(next));
      if (!started.ok && started.error.type !== "already_started") {
        report("couldn't start a queued run", started.error);
      }
    }
  };

  const settledHook = async (event: RunSettled) => {
    try {
      await deps.onSettled?.(event);
    } catch (cause) {
      report("onSettled failed", cause);
    }
  };

  /** After a terminal transition: close the stream, tell the hook, start the next run. */
  const finishTerminal = async (
    row: RunRow,
    usage: TokenUsage | null,
    turn: RunSettled["turn"]
  ) => {
    if (!isTerminal(row.status)) {
      return;
    }
    const closed = await writer.close(row.id, row.status);
    if (!closed.ok) {
      report("couldn't close a run stream", closed.error);
    }
    await settledHook({ run: row, status: row.status, turn, usage });
    await promoteAfter(row.id);
  };

  const failEarly = async (
    run: RunStart,
    assistantMessageId: MessageId,
    error: RunError
  ) => {
    // The client sees why before the stream ends.
    await writer.append(run.runId, { errorText: error.message, type: "error" });
    await updateMessage(db, assistantMessageId, { status: "error" });
    const failed = await transition(run.runId, { error, type: "fail" });
    if (failed) {
      await finishTerminal(failed, null, null);
    } else {
      await settleLostRace(run.runId, null, null);
    }
  };

  /** A run no process is executing any more (the last one crashed). */
  const failOrphan = async (row: RunRow) => {
    if (row.assistantMessageId) {
      await failEarly(
        runStartFromRow(row),
        row.assistantMessageId,
        INTERRUPTED
      );
      return;
    }
    const moved = await transition(row.id, {
      error: INTERRUPTED,
      type: "fail",
    });
    if (moved) {
      await finishTerminal(moved, null, null);
    }
  };

  const loadBranch = async (
    run: RunStart,
    leafId: MessageId
  ): Promise<Message[] | null> => {
    const branch = await getBranchPath(db, run.conversationId, leafId);
    if (!branch.ok) {
      return null;
    }
    return branch.value.messages.flatMap((row) => {
      const message = toMessage(row);
      return message.ok ? [message.value] : [];
    });
  };

  /** Where an outcome leaves the answer and the run. Pure. */
  const landing = (
    runId: RunId,
    outcome: AgentOutcome,
    parts: readonly MessagePart[],
    usage: TokenUsage | null,
    edits: EditsByCall
  ): {
    readonly status: "complete" | "partial" | "error";
    readonly transition: RunTransition;
  } => {
    const spent = usage ?? undefined;
    switch (outcome.status) {
      case "succeeded":
        return {
          status: "complete",
          transition: { type: "succeed", usage: spent },
        };
      case "awaiting_approval": {
        const requestedAt = now().toISOString();
        const approvals: PendingApproval[] = outcome.approvals.map((call) => {
          const proposed = edits.get(call.toolCallId);
          return {
            ...(proposed ? { edits: [...proposed] } : {}),
            input: call.input,
            requestedAt,
            toolCallId: call.toolCallId,
            toolName: call.toolName,
          };
        });
        return {
          status: "partial",
          transition: { approvals, type: "await_approval" },
        };
      }
      case "failed":
        return {
          status: parts.length > 0 ? "partial" : "error",
          transition: { error: outcome.error, type: "fail", usage: spent },
        };
      case "cancelled":
        return {
          status: "partial",
          transition: {
            cancelledBy: cancelledBy.get(runId) ?? null,
            type: "cancel",
          },
        };
      default:
        return outcome satisfies never;
    }
  };

  /** Stores what the agent produced and moves the run to where it ended up. */
  const settle = async (
    run: RunStart,
    assistantMessageId: MessageId,
    outcome: AgentOutcome,
    turn: Turn
  ) => {
    const stored = await getMessage(db, assistantMessageId);
    const decisions = recordedDecisions(stored.ok ? stored.value.parts : []);
    const mapped = fromUIMessage(outcome.message, {
      decisionFor: (toolCallId) => decisions.get(toolCallId),
      now,
    });
    if (!mapped.ok) {
      report("couldn't store the answer's parts", mapped.error);
    }
    const parts = mapped.ok ? withCitations(mapped.value) : [];
    const usage =
      outcome.usage.inputTokens + outcome.usage.outputTokens > 0
        ? outcome.usage
        : null;
    const settledTurn = {
      paidBy: turn.paidBy,
      resolvedModel: turn.resolvedModel,
    };
    const { status, transition: change } = landing(
      run.runId,
      outcome,
      parts,
      usage,
      await proposedEdits(outcome, turn)
    );
    await updateMessage(db, assistantMessageId, {
      model: turn.resolvedModel,
      parts,
      status,
      usage,
    });
    const row = await transition(run.runId, change);
    if (!row) {
      await settleLostRace(run.runId, usage, settledTurn);
    } else if (outcome.status !== "awaiting_approval") {
      await finishTerminal(row, usage, settledTurn);
    }
    // Awaiting approval, the stream stays open: the answer continues in the
    // same stream once someone decides.
  };

  /**
   * The run changed under us (a cancel won the compare-and-set). Whoever
   * won moved it to a terminal state; this process still owns the stream,
   * because it was the one writing to it.
   */
  const settleLostRace = async (
    runId: RunId,
    usage: TokenUsage | null,
    turn: RunSettled["turn"]
  ) => {
    const current = await getRun(db, runId);
    if (current.ok) {
      await finishTerminal(current.value, usage, turn);
    }
  };

  /**
   * Copies the agent's chunks into the run's stream until it ends or the run
   * is cancelled. Appends aren't awaited one by one: the channel keeps call
   * order and batches whatever piles up while a write is in flight. On
   * cancel the reader lets go at once, so a provider that ignores the abort
   * can't hold the run open.
   */
  const pipeToStream = async (
    runId: RunId,
    stream: ReadableStream<UIMessageChunk>,
    signal: AbortSignal
  ): Promise<readonly UIMessageChunk[]> => {
    const reader = stream.getReader();
    const onAbort = () => {
      reader.cancel().catch(() => undefined);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    const chunks: UIMessageChunk[] = [];
    const appends: Promise<Result<number, unknown>>[] = [];
    try {
      for (;;) {
        // biome-ignore lint/performance/noAwaitInLoops: chunks are copied in order.
        const next = await reader.read().catch(() => ({ done: true as const }));
        if (next.done) {
          break;
        }
        chunks.push(next.value);
        appends.push(writer.append(runId, toJson(next.value)));
      }
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
    const lost = (await Promise.all(appends)).find((result) => !result.ok);
    if (lost && !lost.ok) {
      report("run stream write failed", lost.error);
    }
    return chunks;
  };

  /**
   * The agent's outcome. A cancelled run whose provider never noticed the
   * abort has no outcome coming; its answer is rebuilt from the chunks that
   * made it into the stream instead.
   */
  const outcomeOf = async (
    pending: Promise<AgentOutcome>,
    chunks: readonly UIMessageChunk[],
    signal: AbortSignal,
    continuing: UIMessage | undefined
  ): Promise<AgentOutcome> => {
    if (!signal.aborted) {
      return pending;
    }
    const settled = await Promise.race([
      pending,
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), OUTCOME_GRACE_MS)
      ),
    ]);
    if (settled) {
      // An abort surfaces as a provider error on some paths; it's a cancel.
      return settled.status === "failed"
        ? {
            message: settled.message,
            status: "cancelled",
            usage: settled.usage,
          }
        : settled;
    }
    let message: UIMessage = continuing ?? {
      id: "",
      parts: [],
      role: "assistant",
    };
    const replay = new ReadableStream<UIMessageChunk>({
      start: (controller) => {
        for (const chunk of chunks) {
          controller.enqueue(chunk);
        }
        controller.close();
      },
    });
    for await (const snapshot of readUIMessageStream({
      message: continuing,
      stream: replay,
    })) {
      message = snapshot;
    }
    return {
      message,
      status: "cancelled",
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  };

  /** One pass of the agent over the branch, from `leafId`. */
  const execute = async (
    run: RunStart,
    assistantMessageId: MessageId,
    leafId: MessageId,
    controller: AbortController,
    reviews: ToolReviews = new Map()
  ): Promise<void> => {
    try {
      const messages = await loadBranch(run, leafId);
      if (!messages) {
        await failEarly(run, assistantMessageId, INTERNAL);
        return;
      }
      const turn = await deps.resolveTurn(run, {
        reviews,
        signal: controller.signal,
        state: deciderState(messages),
      });
      if (!turn.ok) {
        await failEarly(run, assistantMessageId, turn.error);
        return;
      }
      await setRunResolvedModel(db, run.runId, turn.value.resolvedModel);
      const agentRun = await runAgent({
        generateMessageId: () => assistantMessageId,
        instructions: turn.value.instructions,
        maxSteps: deps.maxSteps,
        messages: toUIMessages(messages, { fileUrl }),
        model: turn.value.model,
        parameters: turn.value.parameters,
        signal: controller.signal,
        timeoutMs: deps.timeoutMs,
        toolApproval: turn.value.toolApproval,
        tools: turn.value.tools,
      });
      if (!agentRun.ok) {
        await failEarly(run, assistantMessageId, agentRun.error);
        return;
      }
      const uiMessages = toUIMessages(messages, { fileUrl });
      const read = await pipeToStream(
        run.runId,
        agentRun.value.stream,
        controller.signal
      );
      const outcome = await outcomeOf(
        agentRun.value.outcome,
        read,
        controller.signal,
        uiMessages.at(-1)?.role === "assistant" ? uiMessages.at(-1) : undefined
      );
      await settle(run, assistantMessageId, outcome, turn.value);
    } catch (cause) {
      report("run failed unexpectedly", cause);
      await failEarly(run, assistantMessageId, INTERNAL).catch(
        (again: unknown) => report("couldn't fail a crashed run", again)
      );
    } finally {
      active.delete(run.runId);
      cancelledBy.delete(run.runId);
    }
  };

  /** Claims a queued run: inserts its empty answer and marks it running, atomically. */
  const claim = async (
    run: RunStart
  ): Promise<Result<MessageId, RunExecutorError>> => {
    const assistantMessageId = newId("message");
    try {
      await db.transaction(async (tx) => {
        const inserted = await insertMessage(tx, {
          authorId: null,
          conversationId: run.conversationId,
          id: assistantMessageId,
          parentId: run.userMessageId,
          parts: [],
          role: "assistant",
          runId: run.runId,
          status: "partial",
        });
        if (!inserted.ok) {
          tx.rollback();
        }
        const started = await transitionRun(
          tx,
          run.runId,
          { assistantMessageId, executor: "in-process", type: "start" },
          now()
        );
        if (!started.ok) {
          // Another executor (or a cancel) got there first.
          tx.rollback();
        }
      });
      return ok(assistantMessageId);
    } catch (cause) {
      if (cause instanceof TransactionRollbackError) {
        return err({ runId: run.runId, type: "already_started" });
      }
      throw cause;
    }
  };

  const startRun = async (
    run: RunStart
  ): Promise<Result<void, RunExecutorError>> => {
    const found = await getRun(db, run.runId);
    if (!found.ok) {
      return err({ runId: run.runId, type: "not_found" });
    }
    const row = found.value;
    if (row.status !== "queued" || active.has(run.runId)) {
      return err({ runId: run.runId, type: "already_started" });
    }
    // Still waiting its turn: the run ahead starts it when it ends.
    if (row.afterRunId) {
      const ahead = await getRun(db, row.afterRunId);
      if (ahead.ok && !isTerminal(ahead.value.status)) {
        return ok(undefined);
      }
    }
    const controller = new AbortController();
    active.set(run.runId, controller);
    const claimed = await claim(run).catch((cause: unknown) => {
      active.delete(run.runId);
      throw cause;
    });
    if (!claimed.ok) {
      active.delete(run.runId);
      return claimed;
    }
    track(
      run.runId,
      execute(run, claimed.value, run.userMessageId, controller)
    );
    return ok(undefined);
  };

  const cancelIdle = async (row: RunRow, by: UserId | null) => {
    const cancelled = await transition(row.id, {
      cancelledBy: by,
      type: "cancel",
    });
    if (!cancelled) {
      return false;
    }
    if (row.assistantMessageId) {
      await updateMessage(db, row.assistantMessageId, { status: "partial" });
    }
    if (row.status === "queued" && row.afterRunId) {
      // Keep the line: whoever waited on this run now waits on the one ahead.
      const ahead = await getRun(db, row.afterRunId);
      if (ahead.ok && !isTerminal(ahead.value.status)) {
        await requeueAfter(db, row.id, ahead.value.id);
      }
    }
    await finishTerminal(cancelled, null, null);
    return true;
  };

  return {
    cancel: async (runId, by) => {
      const found = await getRun(db, runId);
      if (!found.ok) {
        return err({ runId, type: "not_found" });
      }
      const row = found.value;
      if (isTerminal(row.status)) {
        return err({ runId, status: row.status, type: "invalid_state" });
      }
      const controller = active.get(runId);
      if (controller) {
        // The executing pass stores what it has, settles as cancelled and
        // closes the stream after its last chunk.
        cancelledBy.set(runId, by);
        controller.abort();
        await running.get(runId);
        return ok(undefined);
      }
      if (await cancelIdle(row, by)) {
        return ok(undefined);
      }
      const current = await getRun(db, runId);
      return err({
        runId,
        status: current.ok ? current.value.status : row.status,
        type: "invalid_state",
      });
    },

    getState: async (runId) => {
      const found = await getRun(db, runId);
      if (!found.ok) {
        return err({ runId, type: "not_found" });
      }
      const row = found.value;
      const position =
        row.status === "queued"
          ? queuePosition(row, await listActiveRuns(db, row.conversationId))
          : 1;
      return ok(runStateFromRow(row, position));
    },

    idle: async () => {
      while (running.size > 0) {
        // biome-ignore lint/performance/noAwaitInLoops: a settling run may start the next one.
        await Promise.all([...running.values()]);
      }
    },

    recover: async () => {
      const orphaned = (await listRunsWithStatus(db, ["running"])).filter(
        (row) => !active.has(row.id)
      );
      for (const row of orphaned) {
        // biome-ignore lint/performance/noAwaitInLoops: each settles its branch's queue before the next.
        await failOrphan(row);
      }
      // A crash between a run ending and the next one starting leaves that
      // one queued behind a finished run; `startRun` skips any still waiting.
      for (const row of await listRunsWithStatus(db, ["queued"])) {
        // biome-ignore lint/performance/noAwaitInLoops: in order, oldest first, like the queue.
        const started = await startRun(runStartFromRow(row));
        if (!started.ok && started.error.type !== "already_started") {
          report("couldn't start a queued run", started.error);
        }
      }
      return orphaned.length;
    },

    shutdown: async () => {
      for (const controller of active.values()) {
        controller.abort();
      }
      await Promise.all([...running.values()]);
    },

    start: startRun,

    submitApprovals: async (runId, decisions, by) => {
      const found = await getRun(db, runId);
      if (!found.ok) {
        return err({ runId, type: "not_found" });
      }
      const row = found.value;
      if (row.status !== "awaiting_approval" || !row.assistantMessageId) {
        return err({ runId, status: row.status, type: "invalid_state" });
      }
      const pending = new Set((row.approvals ?? []).map((a) => a.toolCallId));
      const unknown = decisions.find((d) => !pending.has(d.toolCallId));
      if (unknown) {
        return err({
          runId,
          toolCallId: unknown.toolCallId,
          type: "unknown_tool_call",
        });
      }
      const answer = await getMessage(db, row.assistantMessageId);
      if (!answer.ok) {
        return err({ message: "the answer is gone", type: "unavailable" });
      }
      const byCall = new Map<string, ToolApproval>(
        decisions.map((d) => [d.toolCallId, d])
      );
      const decidedAt = now().toISOString();
      const parts = answer.value.parts.map((part): MessagePart => {
        const decision =
          part.type === "tool-call" ? byCall.get(part.toolCallId) : undefined;
        return part.type === "tool-call" && decision
          ? {
              ...part,
              approval: {
                decidedAt,
                decidedBy: by,
                decision: decision.decision,
                state: "decided",
              },
            }
          : part;
      });
      await updateMessage(db, row.assistantMessageId, { parts });
      const decided = recordedDecisions(parts);
      if (![...pending].every((id) => decided.has(id))) {
        return ok(undefined);
      }
      const resumed = await transition(runId, { type: "resume" });
      if (!resumed) {
        // Someone else's decision resumed it first, or it was cancelled.
        return ok(undefined);
      }
      const controller = new AbortController();
      active.set(runId, controller);
      const start = runStartFromRow(resumed);
      // Held in memory for this pass only: a crash mid-pass fails the run
      // (`recover`), so no later pass could need them.
      const reviews = reviewsFor(row.approvals ?? [], decided);
      track(
        runId,
        execute(
          start,
          row.assistantMessageId,
          row.assistantMessageId,
          controller,
          reviews
        )
      );
      return ok(undefined);
    },
  };
};
