import type {
  RunStart,
  TerminalRunStatus,
} from "@workspace/ai/ports/run-executor";
import type { RunId } from "@workspace/contract/schemas/common";
import {
  type Run,
  type RunState,
  runOptionsSchema,
} from "@workspace/contract/schemas/runs";
import {
  type StoredContext,
  toChatContext,
} from "@workspace/db/queries/conversations";
import type { RunRow } from "@workspace/db/queries/runs";

// Run rows to the contract's shapes. The row keeps status-specific data in
// nullable columns; `RunState` is the discriminated union clients switch on.
// Pure: every function here is data in, data out.

const iso = (date: Date | null): string | null => date?.toISOString() ?? null;

const INTERNAL_ERROR = {
  code: "internal",
  message: "The run failed.",
  retryable: false,
} as const;

/**
 * A run's state. `position` for a queued run is how many runs wait ahead of
 * it, which the caller works out from the queue (`queuePosition`).
 */
export const runStateFromRow = (row: RunRow, position = 1): RunState => {
  const finishedAt = iso(row.finishedAt) ?? row.updatedAt.toISOString();
  const startedAt = iso(row.startedAt);
  switch (row.status) {
    case "queued":
      return {
        // A queued run with nothing ahead of it is about to start; it waits
        // on itself for the moment the executor takes it.
        afterRunId: row.afterRunId ?? row.id,
        position,
        status: "queued",
      };
    case "running":
      return { startedAt: startedAt ?? finishedAt, status: "running" };
    case "awaiting_approval":
      return row.approvals && row.approvals.length > 0
        ? {
            approvals: row.approvals,
            startedAt: startedAt ?? finishedAt,
            status: "awaiting_approval",
          }
        : { startedAt: startedAt ?? finishedAt, status: "running" };
    case "succeeded":
      return {
        finishedAt,
        startedAt: startedAt ?? finishedAt,
        status: "succeeded",
      };
    case "failed":
      return {
        error: row.error ?? INTERNAL_ERROR,
        finishedAt,
        startedAt,
        status: "failed",
      };
    case "cancelled":
      return {
        cancelledBy: row.cancelledBy,
        finishedAt,
        status: "cancelled",
      };
    default:
      return row.status satisfies never;
  }
};

export const storedContextOf = (row: RunRow): StoredContext =>
  ({ id: row.contextId, type: row.contextType }) as StoredContext;

export const toRun = (row: RunRow, position = 1): Run => ({
  // The row gets its answer's id when it starts; hide it until then, as the
  // contract promises.
  assistantMessageId: row.status === "queued" ? null : row.assistantMessageId,
  context: toChatContext(storedContextOf(row)),
  conversationId: row.conversationId,
  createdAt: row.createdAt.toISOString(),
  createdBy: row.createdBy,
  id: row.id,
  lastSeq: row.lastSeq,
  resolvedModel: row.resolvedModel,
  state: runStateFromRow(row, position),
  target: row.target,
  updatedAt: row.updatedAt.toISOString(),
  usage: row.usage,
  userMessageId: row.userMessageId,
});

/** What the executor needs to run a stored run: the port's `RunStart`. */
export const runStartFromRow = (row: RunRow): RunStart => ({
  context: toChatContext(storedContextOf(row)),
  conversationId: row.conversationId,
  createdBy: row.createdBy,
  options: runOptionsSchema.parse(row.options ?? {}),
  runId: row.id,
  target: row.target,
  userMessageId: row.userMessageId,
});

/**
 * How far back in the line a queued run is: 1 means next. Walks
 * `afterRunId` through the conversation's active runs.
 */
export const queuePosition = (
  row: RunRow,
  active: readonly RunRow[]
): number => {
  const byId = new Map<RunId, RunRow>(active.map((run) => [run.id, run]));
  let position = 1;
  let ahead = row.afterRunId ? byId.get(row.afterRunId) : undefined;
  const seen = new Set<RunId>([row.id]);
  while (ahead?.status === "queued" && !seen.has(ahead.id)) {
    seen.add(ahead.id);
    position += 1;
    ahead = ahead.afterRunId ? byId.get(ahead.afterRunId) : undefined;
  }
  return position;
};

export const isTerminal = (
  status: RunRow["status"]
): status is TerminalRunStatus =>
  status === "succeeded" || status === "failed" || status === "cancelled";
