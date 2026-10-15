import type {
  ConversationId,
  DotId,
  DotScheduleId,
  MessageId,
  RunId,
  UserId,
} from "@workspace/contract/schemas/common";
import type { DotRunTrigger } from "@workspace/contract/schemas/dots";
import type { MessagePart } from "@workspace/contract/schemas/message-parts";
import type { RunError, RunStatus } from "@workspace/contract/schemas/runs";
import { and, asc, desc, eq, inArray, isNotNull, lte } from "drizzle-orm";

import type { Db } from "../client";
import { message, run } from "../schema/chat";
import { dot, dotRun, dotSchedule } from "../schema/dots";

// Dots (172). Every read is scoped to the owner: a Dot is never shared, so a
// wrong owner looks the same as a missing row (`null`), and ids don't leak.

export type DotRow = typeof dot.$inferSelect;
export type DotScheduleRow = typeof dotSchedule.$inferSelect;
export type NewDot = Omit<
  typeof dot.$inferInsert,
  "createdAt" | "id" | "lastViewedAt" | "updatedAt"
>;
export type NewDotSchedule = Omit<
  typeof dotSchedule.$inferInsert,
  "createdAt" | "id" | "lastRunAt" | "lastStatus" | "updatedAt"
>;
export type DotPatch = Partial<
  Pick<
    DotRow,
    | "autoApproveTools"
    | "enabled"
    | "instructions"
    | "name"
    | "sandboxProvider"
    | "target"
  >
>;
export type DotSchedulePatch = Partial<
  Pick<DotScheduleRow, "cron" | "enabled" | "nextRunAt" | "prompt" | "timezone">
>;

/** A Dot's latest run, joined with the run row and the start of its reply. */
export interface DotLastRunRow {
  readonly createdAt: Date;
  readonly dotId: DotId;
  readonly error: RunError | null;
  readonly finishedAt: Date | null;
  readonly replyParts: readonly MessagePart[] | null;
  readonly runId: RunId;
  readonly scheduleId: DotScheduleId | null;
  readonly startedAt: Date | null;
  readonly status: RunStatus;
  readonly trigger: DotRunTrigger;
}

export const insertDot = async (db: Db, input: NewDot): Promise<DotRow> => {
  const [row] = await db.insert(dot).values(input).returning();
  if (!row) {
    throw new Error("insert dot returned nothing");
  }
  return row;
};

export const getDot = async (
  db: Db,
  id: DotId,
  ownerId: UserId
): Promise<DotRow | null> => {
  const [row] = await db
    .select()
    .from(dot)
    .where(and(eq(dot.id, id), eq(dot.ownerId, ownerId)));
  return row ?? null;
};

/** The Dot whatever its owner: for jobs, which re-check access themselves. */
export const getDotById = async (db: Db, id: DotId): Promise<DotRow | null> => {
  const [row] = await db.select().from(dot).where(eq(dot.id, id));
  return row ?? null;
};

export const getDotByConversation = async (
  db: Db,
  conversationId: ConversationId
): Promise<DotRow | null> => {
  const [row] = await db
    .select()
    .from(dot)
    .where(eq(dot.conversationId, conversationId));
  return row ?? null;
};

/** The owner's Dots, newest first. */
export const listDots = (db: Db, ownerId: UserId): Promise<DotRow[]> =>
  db
    .select()
    .from(dot)
    .where(eq(dot.ownerId, ownerId))
    .orderBy(desc(dot.createdAt), desc(dot.id));

export const updateDot = async (
  db: Db,
  id: DotId,
  ownerId: UserId,
  patch: DotPatch
): Promise<DotRow | null> => {
  const [row] = await db
    .update(dot)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(dot.id, id), eq(dot.ownerId, ownerId)))
    .returning();
  return row ?? null;
};

export const markDotViewed = async (
  db: Db,
  id: DotId,
  ownerId: UserId,
  at: Date
): Promise<DotRow | null> => {
  const [row] = await db
    .update(dot)
    .set({ lastViewedAt: at })
    .where(and(eq(dot.id, id), eq(dot.ownerId, ownerId)))
    .returning();
  return row ?? null;
};

/** `true` when it existed and was the owner's. */
export const deleteDot = async (
  db: Db,
  id: DotId,
  ownerId: UserId
): Promise<boolean> => {
  const rows = await db
    .delete(dot)
    .where(and(eq(dot.id, id), eq(dot.ownerId, ownerId)))
    .returning({ id: dot.id });
  return rows.length > 0;
};

export const insertDotSchedules = async (
  db: Db,
  rows: readonly NewDotSchedule[]
): Promise<DotScheduleRow[]> =>
  rows.length === 0
    ? []
    : await db
        .insert(dotSchedule)
        .values([...rows])
        .returning();

/** Schedules of the given Dots, oldest first. */
export const listDotSchedules = (
  db: Db,
  dotIds: readonly DotId[]
): Promise<DotScheduleRow[]> =>
  dotIds.length === 0
    ? Promise.resolve([])
    : db
        .select()
        .from(dotSchedule)
        .where(inArray(dotSchedule.dotId, [...dotIds]))
        .orderBy(asc(dotSchedule.createdAt), asc(dotSchedule.id));

/** A schedule with its Dot, when the Dot is `ownerId`'s. */
export const getDotSchedule = async (
  db: Db,
  id: DotScheduleId,
  ownerId: UserId
): Promise<{
  readonly dot: DotRow;
  readonly schedule: DotScheduleRow;
} | null> => {
  const [row] = await db
    .select({ dot, schedule: dotSchedule })
    .from(dotSchedule)
    .innerJoin(dot, eq(dot.id, dotSchedule.dotId))
    .where(and(eq(dotSchedule.id, id), eq(dot.ownerId, ownerId)));
  return row ?? null;
};

export const updateDotSchedule = async (
  db: Db,
  id: DotScheduleId,
  patch: DotSchedulePatch
): Promise<DotScheduleRow | null> => {
  const [row] = await db
    .update(dotSchedule)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(dotSchedule.id, id))
    .returning();
  return row ?? null;
};

export const deleteDotSchedule = async (
  db: Db,
  id: DotScheduleId
): Promise<void> => {
  await db.delete(dotSchedule).where(eq(dotSchedule.id, id));
};

/**
 * Claims every enabled schedule of an enabled Dot due at `now`: moves its
 * `next_run_at` on with `next` and stamps `last_run_at`, in one transaction
 * with `skip locked`, so two ticks (or two processes) never fire the same
 * occurrence. Returns the claimed rows as they were before the claim.
 */
export const claimDueDotSchedules = (
  db: Db,
  now: Date,
  next: (schedule: DotScheduleRow) => Date | null,
  limit = 100
): Promise<DotScheduleRow[]> =>
  db.transaction(async (tx) => {
    const due = await tx
      .select({ schedule: dotSchedule })
      .from(dotSchedule)
      .innerJoin(dot, eq(dot.id, dotSchedule.dotId))
      .where(
        and(
          eq(dotSchedule.enabled, true),
          eq(dot.enabled, true),
          isNotNull(dotSchedule.nextRunAt),
          lte(dotSchedule.nextRunAt, now)
        )
      )
      .orderBy(asc(dotSchedule.nextRunAt))
      .limit(limit)
      .for("update", { of: dotSchedule, skipLocked: true });
    for (const { schedule } of due) {
      // biome-ignore lint/performance/noAwaitInLoops: one small update per due schedule, inside the claim's transaction.
      await tx
        .update(dotSchedule)
        .set({ lastRunAt: now, nextRunAt: next(schedule) })
        .where(eq(dotSchedule.id, schedule.id));
    }
    return due.map(({ schedule }) => schedule);
  });

export const insertDotRun = async (
  db: Db,
  input: {
    readonly dotId: DotId;
    readonly runId: RunId;
    readonly scheduleId: DotScheduleId | null;
    readonly trigger: DotRunTrigger;
  }
): Promise<void> => {
  await db.insert(dotRun).values(input).onConflictDoNothing();
};

/** The Dot (and schedule) that started `runId`, if a Dot did. */
export const dotForRun = async (
  db: Db,
  runId: RunId
): Promise<{
  readonly dot: DotRow;
  readonly scheduleId: DotScheduleId | null;
} | null> => {
  const [row] = await db
    .select({ dot, scheduleId: dotRun.scheduleId })
    .from(dotRun)
    .innerJoin(dot, eq(dot.id, dotRun.dotId))
    .where(eq(dotRun.runId, runId));
  return row ?? null;
};

export const setDotScheduleStatus = async (
  db: Db,
  id: DotScheduleId,
  status: RunStatus
): Promise<void> => {
  await db
    .update(dotSchedule)
    .set({ lastStatus: status })
    .where(eq(dotSchedule.id, id));
};

/** Each Dot's latest run, with the run's state and the reply's parts. */
export const latestDotRuns = async (
  db: Db,
  dotIds: readonly DotId[]
): Promise<DotLastRunRow[]> => {
  if (dotIds.length === 0) {
    return [];
  }
  const rows = await db
    .selectDistinctOn([dotRun.dotId], {
      createdAt: dotRun.createdAt,
      dotId: dotRun.dotId,
      error: run.error,
      finishedAt: run.finishedAt,
      replyParts: message.parts,
      runId: dotRun.runId,
      scheduleId: dotRun.scheduleId,
      startedAt: run.startedAt,
      status: run.status,
      trigger: dotRun.trigger,
    })
    .from(dotRun)
    .innerJoin(run, eq(run.id, dotRun.runId))
    .leftJoin(message, eq(message.id, run.assistantMessageId))
    .where(inArray(dotRun.dotId, [...dotIds]))
    .orderBy(dotRun.dotId, desc(dotRun.createdAt), desc(dotRun.id));
  return rows;
};

/** The conversation's newest message: a Dot's run posts after it. */
export const latestMessageId = async (
  db: Db,
  conversationId: ConversationId
): Promise<MessageId | null> => {
  const [row] = await db
    .select({ id: message.id })
    .from(message)
    .where(eq(message.conversationId, conversationId))
    .orderBy(desc(message.createdAt), desc(message.id))
    .limit(1);
  return row?.id ?? null;
};

/** How the schedule's latest runs ended, newest first. */
export const recentScheduleStatuses = async (
  db: Db,
  scheduleId: DotScheduleId,
  limit: number
): Promise<RunStatus[]> => {
  const rows = await db
    .select({ status: run.status })
    .from(dotRun)
    .innerJoin(run, eq(run.id, dotRun.runId))
    .where(eq(dotRun.scheduleId, scheduleId))
    .orderBy(desc(dotRun.createdAt), desc(dotRun.id))
    .limit(limit);
  return rows.map((row) => row.status);
};

/** The schedule whatever its owner: for the job that fires it. */
export const getDotScheduleById = async (
  db: Db,
  id: DotScheduleId
): Promise<DotScheduleRow | null> => {
  const [row] = await db
    .select()
    .from(dotSchedule)
    .where(eq(dotSchedule.id, id));
  return row ?? null;
};
