import {
  type ConversationId,
  type JsonValue,
  type MessageId,
  messageIdSchema,
  type RunId,
  type UserId,
  userIdSchema,
} from "@workspace/contract/schemas/common";
import {
  type ModelRef,
  modelRefSchema,
  tokenUsageSchema,
} from "@workspace/contract/schemas/models";
import {
  pendingApprovalSchema,
  type RunOptions,
  type RunStatus,
  type RunTarget,
  runErrorSchema,
  type StreamChunk,
} from "@workspace/contract/schemas/runs";
import { type AsyncResult, err, ok } from "@workspace/shared/result";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  notInArray,
  type SQL,
  sql,
} from "drizzle-orm";
import { z } from "zod";

import type { Db } from "../client";
import {
  type ConflictError,
  conflict,
  type NotFoundError,
  notFound,
} from "../errors";
import { ACTIVE_RUN_STATUSES, run, runChunk } from "../schema/chat";
import type { StoredContext } from "./conversations";
import {
  decodeCursor,
  type InvalidCursorError,
  type Page,
  toPage,
} from "./page";

// Runs (D4): a chat turn, executed detached from the request. Status changes
// go through `transitionRun`, a compare-and-set on the current status, so
// two executors (or an executor and a cancel) can't both win. The stream is
// stored as `run_chunk` rows with gapless sequence numbers for resume.

export type RunRow = typeof run.$inferSelect;

export interface NewRun {
  readonly afterRunId?: RunId | null;
  /** The target is an agent's draft (a builder test run). */
  readonly agentDraft?: boolean;
  readonly context: StoredContext;
  readonly conversationId: ConversationId;
  readonly createdBy: UserId;
  readonly idempotencyKey?: string | null;
  readonly options?: RunOptions | null;
  /** `queued` behind `afterRunId` when the branch is busy, else `running` once an executor takes it. */
  readonly status?: Extract<RunStatus, "queued" | "running">;
  readonly target: RunTarget;
  readonly userMessageId: MessageId;
}

export interface CreatedRun {
  /** `false` when `idempotencyKey` matched an earlier run, which is returned instead. */
  readonly created: boolean;
  readonly run: RunRow;
}

export const createRun = async (db: Db, input: NewRun): Promise<CreatedRun> => {
  const status = input.status ?? "queued";
  const [row] = await db
    .insert(run)
    .values({
      afterRunId: input.afterRunId ?? null,
      agentDraft: input.agentDraft ?? false,
      contextId: input.context.id,
      contextType: input.context.type,
      conversationId: input.conversationId,
      createdBy: input.createdBy,
      idempotencyKey: input.idempotencyKey ?? null,
      options: input.options ?? null,
      startedAt: status === "running" ? new Date() : null,
      status,
      target: input.target,
      userMessageId: input.userMessageId,
    })
    .onConflictDoNothing({
      target: [run.createdBy, run.idempotencyKey],
      where: sql`${run.idempotencyKey} is not null`,
    })
    .returning();
  if (row) {
    return { created: true, run: row };
  }
  const [existing] = await db
    .select()
    .from(run)
    .where(
      and(
        eq(run.createdBy, input.createdBy),
        eq(run.idempotencyKey, input.idempotencyKey ?? "")
      )
    );
  if (!existing) {
    throw new Error("idempotent insert skipped but no run matched");
  }
  return { created: false, run: existing };
};

export const getRun = async (
  db: Db,
  id: RunId
): AsyncResult<RunRow, NotFoundError> => {
  const [row] = await db.select().from(run).where(eq(run.id, id));
  return row ? ok(row) : err(notFound("run", id));
};

/**
 * The run, locked until the transaction `db` belongs to ends (`SELECT …
 * FOR UPDATE`): deciding approvals reads and rewrites the run's answer, and
 * two decisions at once must not each overwrite the other's (072).
 */
export const lockRun = async (
  db: Db,
  id: RunId
): AsyncResult<RunRow, NotFoundError> => {
  const [row] = await db.select().from(run).where(eq(run.id, id)).for("update");
  return row ? ok(row) : err(notFound("run", id));
};

/** Unfinished runs in a conversation, oldest first (the branch queue reads this). */
export const listActiveRuns = (
  db: Db,
  conversationId: ConversationId
): Promise<RunRow[]> =>
  db
    .select()
    .from(run)
    .where(
      and(
        eq(run.conversationId, conversationId),
        inArray(run.status, [...ACTIVE_RUN_STATUSES])
      )
    )
    .orderBy(asc(run.createdAt), asc(run.id));

/**
 * Every run in one of `statuses`, oldest first, across all conversations.
 * For boot-time recovery: a run still `running` when the process starts was
 * orphaned by the last one.
 */
export const listRunsWithStatus = (
  db: Db,
  statuses: readonly RunStatus[]
): Promise<RunRow[]> =>
  db
    .select()
    .from(run)
    .where(inArray(run.status, [...statuses]))
    .orderBy(asc(run.createdAt), asc(run.id));

/** Queued runs waiting on `runId`: the ones to start when it finishes. */
export const listQueuedAfter = (db: Db, runId: RunId): Promise<RunRow[]> =>
  db
    .select()
    .from(run)
    .where(and(eq(run.afterRunId, runId), eq(run.status, "queued")))
    .orderBy(asc(run.createdAt), asc(run.id));

/** A status change and the data that comes with it. */
export const runTransitionSchema = z.discriminatedUnion("type", [
  z.object({
    assistantMessageId: messageIdSchema.optional(),
    executor: z.string().max(64).optional(),
    resolvedModel: modelRefSchema.optional(),
    type: z.literal("start"),
  }),
  z.object({
    approvals: z.array(pendingApprovalSchema).min(1),
    type: z.literal("await_approval"),
  }),
  z.object({ type: z.literal("resume") }),
  z.object({
    type: z.literal("succeed"),
    usage: tokenUsageSchema.optional(),
  }),
  z.object({
    error: runErrorSchema,
    type: z.literal("fail"),
    usage: tokenUsageSchema.optional(),
  }),
  z.object({
    /** `null` when the system cancelled it. */
    cancelledBy: userIdSchema.nullable(),
    type: z.literal("cancel"),
  }),
]);
export type RunTransition = z.infer<typeof runTransitionSchema>;

const TARGET: Record<RunTransition["type"], RunStatus> = {
  await_approval: "awaiting_approval",
  cancel: "cancelled",
  fail: "failed",
  resume: "running",
  start: "running",
  succeed: "succeeded",
};

/** Which statuses each transition may leave. Terminal statuses leave to nothing. */
const FROM: Record<RunTransition["type"], readonly RunStatus[]> = {
  await_approval: ["running"],
  cancel: ["queued", "running", "awaiting_approval"],
  fail: ["queued", "running", "awaiting_approval"],
  resume: ["awaiting_approval"],
  start: ["queued"],
  succeed: ["running"],
};

/** Whether `transition` may apply to a run in `status`. */
export const canTransition = (
  status: RunStatus,
  transition: RunTransition["type"]
): boolean => FROM[transition].includes(status);

const changesFor = (transition: RunTransition, now: Date) => {
  switch (transition.type) {
    case "start":
      return {
        startedAt: now,
        ...(transition.assistantMessageId
          ? { assistantMessageId: transition.assistantMessageId }
          : {}),
        ...(transition.executor ? { executor: transition.executor } : {}),
        ...(transition.resolvedModel
          ? { resolvedModel: transition.resolvedModel }
          : {}),
      };
    case "await_approval":
      return { approvals: transition.approvals };
    case "resume":
      return { approvals: null };
    case "succeed":
      return {
        approvals: null,
        finishedAt: now,
        ...(transition.usage ? { usage: transition.usage } : {}),
      };
    case "fail":
      return {
        approvals: null,
        error: transition.error,
        finishedAt: now,
        ...(transition.usage ? { usage: transition.usage } : {}),
      };
    case "cancel":
      return {
        approvals: null,
        cancelledBy: transition.cancelledBy,
        finishedAt: now,
      };
    default:
      return transition satisfies never;
  }
};

/**
 * Moves a run to its next status if it's still in one the transition may
 * leave. Losing a race (the run was cancelled meanwhile) is a `conflict`
 * with reason `invalid_transition`, not an exception.
 */
export const transitionRun = async (
  db: Db,
  id: RunId,
  transition: RunTransition,
  now: Date = new Date()
): AsyncResult<RunRow, NotFoundError | ConflictError> => {
  const [row] = await db
    .update(run)
    .set({ status: TARGET[transition.type], ...changesFor(transition, now) })
    .where(and(eq(run.id, id), inArray(run.status, [...FROM[transition.type]])))
    .returning();
  if (row) {
    return ok(row);
  }
  const current = await getRun(db, id);
  return current.ok
    ? err(
        conflict(
          "invalid_transition",
          `${current.value.status} -> ${TARGET[transition.type]}`
        )
      )
    : current;
};

// --- Stream chunks ---

/**
 * Appends chunks to a run's stream and returns the last `seq` written.
 * Bumping `run.last_seq` first locks the run row, so concurrent appends get
 * consecutive, gapless numbers.
 */
export const appendRunChunks = (
  db: Db,
  runId: RunId,
  payloads: readonly JsonValue[]
): AsyncResult<number, NotFoundError> =>
  db.transaction(async (tx) => {
    const [bumped] = await tx
      .update(run)
      .set({ lastSeq: sql`${run.lastSeq} + ${payloads.length}` })
      .where(eq(run.id, runId))
      .returning({ lastSeq: run.lastSeq });
    if (!bumped) {
      return err(notFound("run", runId));
    }
    if (payloads.length > 0) {
      const first = bumped.lastSeq - payloads.length + 1;
      await tx.insert(runChunk).values(
        payloads.map((payload, index) => ({
          payload,
          runId,
          seq: first + index,
        }))
      );
    }
    return ok(bumped.lastSeq);
  });

export interface ReadChunksOptions {
  /** The last `seq` the client has; `0` replays from the start. */
  readonly after?: number;
  readonly limit?: number;
}

/** Stored chunks after the cursor, in order. */
export const readRunChunks = async (
  db: Db,
  runId: RunId,
  { after = 0, limit = 1000 }: ReadChunksOptions = {}
): Promise<StreamChunk[]> =>
  await db
    .select({ payload: runChunk.payload, seq: runChunk.seq })
    .from(runChunk)
    .where(and(eq(runChunk.runId, runId), gt(runChunk.seq, after)))
    .orderBy(asc(runChunk.seq))
    .limit(limit);

/** Drops a finished run's chunks; the message holds the result. Returns how many went. */
export const pruneRunChunks = async (db: Db, runId: RunId): Promise<number> => {
  const deleted = await db
    .delete(runChunk)
    .where(eq(runChunk.runId, runId))
    .returning({ seq: runChunk.seq });
  return deleted.length;
};

// --- Added for the run service (ticket 014) ---

/**
 * Re-points runs queued behind `fromRunId` to wait for `toRunId` instead
 * (`null`: nothing to wait for). Used when a queued run is cancelled, so the
 * ones behind it keep their place in the line. Returns the runs it moved.
 */
export const requeueAfter = (
  db: Db,
  fromRunId: RunId,
  toRunId: RunId | null
): Promise<RunRow[]> =>
  db
    .update(run)
    .set({ afterRunId: toRunId })
    .where(and(eq(run.afterRunId, fromRunId), eq(run.status, "queued")))
    .returning();

export interface ListRunsInput {
  /** `true`: unfinished runs only (the queue); `false`: finished ones only. */
  readonly active?: boolean;
  readonly cursor?: string;
  readonly limit: number;
}

/** Runs in a conversation, newest first. */
export const listRuns = async (
  db: Db,
  conversationId: ConversationId,
  input: ListRunsInput
): AsyncResult<Page<RunRow>, InvalidCursorError> => {
  const cursor = input.cursor ? decodeCursor(input.cursor) : undefined;
  if (cursor && !cursor.ok) {
    return cursor;
  }
  let activeFilter: SQL | undefined;
  if (input.active !== undefined) {
    activeFilter = input.active
      ? inArray(run.status, [...ACTIVE_RUN_STATUSES])
      : notInArray(run.status, [...ACTIVE_RUN_STATUSES]);
  }
  const rows = await db
    .select()
    .from(run)
    .where(
      and(
        eq(run.conversationId, conversationId),
        activeFilter,
        cursor?.ok
          ? sql`(${run.createdAt}, ${run.id}) < (${String(cursor.value.key)}::timestamptz, ${cursor.value.id}::uuid)`
          : undefined
      )
    )
    .orderBy(desc(run.createdAt), desc(run.id))
    .limit(input.limit + 1);
  return ok(
    toPage(rows, input.limit, (row) => ({
      id: row.id,
      key: row.createdAt.toISOString(),
    }))
  );
};

/**
 * Records the concrete model once routing resolved it. The run has already
 * started (the executor claims a run before it resolves the model, so
 * `createRun` can answer at once), so this isn't a status transition.
 */
export const setRunResolvedModel = async (
  db: Db,
  id: RunId,
  resolvedModel: ModelRef
): AsyncResult<RunRow, NotFoundError> => {
  const [row] = await db
    .update(run)
    .set({ resolvedModel })
    .where(eq(run.id, id))
    .returning();
  return row ? ok(row) : err(notFound("run", id));
};
