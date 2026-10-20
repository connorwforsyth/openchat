import type {
  ConversationId,
  DotId,
  DotRunId,
  DotScheduleId,
  MessageId,
  RunId,
  UserId,
} from "@workspace/contract/schemas/common";
import type { DotRunTrigger } from "@workspace/contract/schemas/dots";
import type { MessagePart } from "@workspace/contract/schemas/message-parts";
import type { RunError, RunStatus } from "@workspace/contract/schemas/runs";
import type {
  ScheduleRunOutcome,
  ScheduleSkipReason,
} from "@workspace/contract/schemas/schedules";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";

import type { Db } from "../client";
import { message, run } from "../schema/chat";
import { dot, dotRun, dotSchedule } from "../schema/dots";

// Dots (172, 174) and schedules (173). Every read is scoped to the owner: a
// Dot or schedule is never shared, so a wrong owner looks the same as a
// missing row (`null`), and ids don't leak. The job paths have `…ById`
// variants; they re-check access through `createRun`.

export type DotRow = typeof dot.$inferSelect;
export type ScheduleRow = typeof dotSchedule.$inferSelect;
/** @deprecated The 172 name; a Dot's schedule is a `ScheduleRow`. */
export type DotScheduleRow = ScheduleRow;
export type ScheduleRunRow = typeof dotRun.$inferSelect;
export type NewDot = Omit<
  typeof dot.$inferInsert,
  "createdAt" | "id" | "lastViewedAt" | "primary" | "updatedAt"
>;
export type NewSchedule = Omit<
  typeof dotSchedule.$inferInsert,
  "createdAt" | "lastRunAt" | "lastStatus" | "lastOutcome" | "updatedAt"
>;
export type DotPatch = Partial<
  Pick<
    DotRow,
    | "autoApproveTools"
    | "avatarColor"
    | "avatarStyle"
    | "enabled"
    | "handle"
    | "instructions"
    | "name"
    | "rules"
    | "sandboxProvider"
    | "target"
  >
>;
export type SchedulePatch = Partial<
  Omit<ScheduleRow, "createdAt" | "id" | "ownerId" | "updatedAt">
>;
export type NewScheduleRun = Omit<
  typeof dotRun.$inferInsert,
  "createdAt" | "id"
>;
export type ScheduleRunPatch = Partial<
  Pick<
    ScheduleRunRow,
    | "conversationId"
    | "notified"
    | "outcome"
    | "readAt"
    | "runId"
    | "skipReason"
    | "summary"
  >
>;

/** A run of a schedule or Dot, joined with the run row and the start of its reply. */
export interface ScheduleRunView {
  readonly conversationId: ConversationId | null;
  readonly createdAt: Date;
  readonly dotId: DotId | null;
  readonly error: RunError | null;
  readonly finishedAt: Date | null;
  readonly id: DotRunId;
  readonly missedSlots: number;
  readonly nominalAt: Date | null;
  readonly notified: boolean;
  readonly outcome: ScheduleRunOutcome | null;
  readonly readAt: Date | null;
  readonly replyParts: readonly MessagePart[] | null;
  readonly runId: RunId | null;
  readonly scheduleId: DotScheduleId | null;
  readonly skipReason: ScheduleSkipReason | null;
  readonly startedAt: Date | null;
  readonly status: RunStatus | null;
  readonly summary: string | null;
  readonly trigger: DotRunTrigger;
}
/** @deprecated The 172 name. */
export type DotLastRunRow = ScheduleRunView;

const runView = {
  conversationId: dotRun.conversationId,
  createdAt: dotRun.createdAt,
  dotId: dotRun.dotId,
  error: run.error,
  finishedAt: run.finishedAt,
  id: dotRun.id,
  missedSlots: dotRun.missedSlots,
  nominalAt: dotRun.nominalAt,
  notified: dotRun.notified,
  outcome: dotRun.outcome,
  readAt: dotRun.readAt,
  replyParts: message.parts,
  runId: dotRun.runId,
  scheduleId: dotRun.scheduleId,
  skipReason: dotRun.skipReason,
  startedAt: run.startedAt,
  status: run.status,
  summary: dotRun.summary,
  trigger: dotRun.trigger,
};

const ACTIVE_RUN: readonly RunStatus[] = [
  "queued",
  "running",
  "awaiting_approval",
];

const spendsCap = and(
  isNull(dotRun.skipReason),
  or(isNotNull(dotRun.runId), isNull(dotRun.outcome))
);

const CAP_LOCK_SPACE = 175;

const lockCap = async (tx: Db, ownerId: UserId): Promise<void> => {
  await tx.execute(
    sql`select pg_advisory_xact_lock(${CAP_LOCK_SPACE}, hashtext(${ownerId}))`
  );
};

// --- Dots -----------------------------------------------------------------

/** Inserts the owner's Dot; `null` when they already have one (174). */
export const insertDot = async (
  db: Db,
  input: NewDot
): Promise<DotRow | null> => {
  const [row] = await db
    .insert(dot)
    .values({ ...input, primary: true })
    .onConflictDoNothing({ target: dot.ownerId })
    .returning();
  return row ?? null;
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

/** The owner's one Dot, if they've made it. */
export const getOwnersDot = async (
  db: Db,
  ownerId: UserId
): Promise<DotRow | null> => {
  const [row] = await db.select().from(dot).where(eq(dot.ownerId, ownerId));
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

/** The owner's Dots: at most one since 174. */
export const listDots = (db: Db, ownerId: UserId): Promise<DotRow[]> =>
  db
    .select()
    .from(dot)
    .where(eq(dot.ownerId, ownerId))
    .orderBy(desc(dot.createdAt), desc(dot.id));

/** Whether another of the owner's Dots has `handle`. */
export const dotHandleTaken = async (
  db: Db,
  ownerId: UserId,
  handle: string,
  except: DotId | null
): Promise<boolean> => {
  const [row] = await db
    .select({ id: dot.id })
    .from(dot)
    .where(
      and(
        eq(dot.ownerId, ownerId),
        eq(dot.handle, handle),
        except ? ne(dot.id, except) : undefined
      )
    )
    .limit(1);
  return Boolean(row);
};

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
  if (row) {
    await db
      .update(dotRun)
      .set({ readAt: at })
      .where(and(eq(dotRun.dotId, id), isNull(dotRun.readAt)));
  }
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

// --- Schedules ------------------------------------------------------------

export const insertSchedules = async (
  db: Db,
  rows: readonly NewSchedule[]
): Promise<ScheduleRow[]> =>
  rows.length === 0
    ? []
    : await db
        .insert(dotSchedule)
        .values([...rows])
        .returning();

/** Schedules targeting the given Dots, oldest first. */
export const listDotSchedules = (
  db: Db,
  dotIds: readonly DotId[]
): Promise<ScheduleRow[]> =>
  dotIds.length === 0
    ? Promise.resolve([])
    : db
        .select()
        .from(dotSchedule)
        .where(inArray(dotSchedule.dotId, [...dotIds]))
        .orderBy(asc(dotSchedule.createdAt), asc(dotSchedule.id));

/** The owner's schedules: active by next run, then paused and completed. */
export const listSchedules = (
  db: Db,
  ownerId: UserId,
  filter: {
    readonly conversationId?: ConversationId;
    readonly status?: "active" | "paused" | "completed";
  } = {}
): Promise<ScheduleRow[]> => {
  const status = (() => {
    switch (filter.status) {
      case "active":
        return and(
          eq(dotSchedule.enabled, true),
          isNull(dotSchedule.completedAt)
        );
      case "paused":
        return and(
          eq(dotSchedule.enabled, false),
          isNull(dotSchedule.completedAt)
        );
      case "completed":
        return isNotNull(dotSchedule.completedAt);
      default:
        return;
    }
  })();
  return db
    .select()
    .from(dotSchedule)
    .where(
      and(
        eq(dotSchedule.ownerId, ownerId),
        filter.conversationId
          ? eq(dotSchedule.conversationId, filter.conversationId)
          : undefined,
        status
      )
    )
    .orderBy(
      sql`${dotSchedule.completedAt} is not null`,
      desc(dotSchedule.enabled),
      sql`${dotSchedule.nextRunNominalAt} asc nulls last`,
      desc(dotSchedule.createdAt)
    );
};

export const getSchedule = async (
  db: Db,
  id: DotScheduleId,
  ownerId: UserId
): Promise<ScheduleRow | null> => {
  const [row] = await db
    .select()
    .from(dotSchedule)
    .where(and(eq(dotSchedule.id, id), eq(dotSchedule.ownerId, ownerId)));
  return row ?? null;
};

/** The schedule whatever its owner: for the job that fires it. */
export const getScheduleById = async (
  db: Db,
  id: DotScheduleId
): Promise<ScheduleRow | null> => {
  const [row] = await db
    .select()
    .from(dotSchedule)
    .where(eq(dotSchedule.id, id));
  return row ?? null;
};

export const updateSchedule = async (
  db: Db,
  id: DotScheduleId,
  patch: SchedulePatch
): Promise<ScheduleRow | null> => {
  const [row] = await db
    .update(dotSchedule)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(dotSchedule.id, id))
    .returning();
  return row ?? null;
};

export const deleteSchedule = async (
  db: Db,
  id: DotScheduleId
): Promise<void> => {
  await db.delete(dotSchedule).where(eq(dotSchedule.id, id));
};

/**
 * Pauses every active schedule posting into the conversation (its target
 * was archived): returns how many.
 */
export const pauseSchedulesFor = async (
  db: Db,
  conversationId: ConversationId
): Promise<number> => {
  const rows = await db
    .update(dotSchedule)
    .set({
      enabled: false,
      nextRunAt: null,
      nextRunNominalAt: null,
      pausedReason: "target_archived",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(dotSchedule.conversationId, conversationId),
        eq(dotSchedule.enabled, true),
        isNull(dotSchedule.completedAt)
      )
    )
    .returning({ id: dotSchedule.id });
  return rows.length;
};

/**
 * For each conversation, its active schedule due soonest (or else a paused
 * one): the `Conversation.schedule` summary on sidebar rows.
 */
export const scheduleSummaries = async (
  db: Db,
  ownerId: UserId,
  conversationIds: readonly ConversationId[]
): Promise<ReadonlyMap<ConversationId, ScheduleRow>> => {
  if (conversationIds.length === 0) {
    return new Map();
  }
  const rows = await db
    .selectDistinctOn([dotSchedule.conversationId])
    .from(dotSchedule)
    .where(
      and(
        eq(dotSchedule.ownerId, ownerId),
        inArray(dotSchedule.conversationId, [...conversationIds]),
        isNull(dotSchedule.completedAt)
      )
    )
    .orderBy(
      dotSchedule.conversationId,
      desc(dotSchedule.enabled),
      sql`${dotSchedule.nextRunNominalAt} asc nulls last`
    );
  return new Map(
    rows.flatMap((row) =>
      row.conversationId ? [[row.conversationId, row] as const] : []
    )
  );
};

/** What the tick knows about a due schedule when it decides what to do. */
export interface DueContext {
  /** The target thread has a run in flight or waiting on approval. */
  readonly busy: boolean;
  /** The owner's runs started in the last 24 hours, counting this tick's. */
  readonly runsToday: number;
}

/** What the tick does with one due schedule. */
export interface DueDecision {
  /** Fire it: hand it to `dot.run` with this nominal slot. */
  readonly fire: {
    readonly missedSlots: number;
    readonly nominal: Date;
  } | null;
  readonly patch: SchedulePatch;
  /** Record a skipped slot. */
  readonly skip: Omit<NewScheduleRun, "ownerId" | "scheduleId"> | null;
}

const lockedRunsToday = async (
  tx: Db,
  ownerIds: readonly UserId[],
  now: Date
): Promise<Map<UserId, number>> => {
  const owners = [...new Set(ownerIds)].sort();
  for (const owner of owners) {
    // biome-ignore lint/performance/noAwaitInLoops: the locks must be taken one at a time, in order.
    await lockCap(tx, owner);
  }
  const counted = await tx
    .select({ n: count(), ownerId: dotRun.ownerId })
    .from(dotRun)
    .where(
      and(
        inArray(dotRun.ownerId, owners),
        spendsCap,
        gt(dotRun.createdAt, new Date(now.getTime() - 86_400_000))
      )
    )
    .groupBy(dotRun.ownerId);
  return new Map(counted.map((row) => [row.ownerId, Number(row.n)]));
};

const insertSlotClaim = async (
  tx: Db,
  schedule: ScheduleRow,
  fire: NonNullable<DueDecision["fire"]>,
  now: Date
): Promise<ScheduleRunRow> => {
  const [claim] = await tx
    .insert(dotRun)
    .values({
      conversationId: schedule.conversationId,
      createdAt: now,
      dotId: schedule.dotId,
      missedSlots: fire.missedSlots,
      nominalAt: fire.nominal,
      notified: false,
      ownerId: schedule.ownerId,
      scheduleId: schedule.id,
      trigger: "schedule",
    })
    .returning();
  if (!claim) {
    throw new Error("insert returned no row");
  }
  return claim;
};

/**
 * Claims every active schedule due at `now`, in one transaction with `skip
 * locked` so two ticks (or processes) never fire the same slot. `decide` is
 * the pure policy (fire, defer, skip, complete); this applies its patch,
 * records its skips, and records each slot it fires as a claim on the
 * owner's cap. Returns the claims, for `dot.run` to start.
 */
export const claimDueSchedules = (
  db: Db,
  now: Date,
  decide: (schedule: ScheduleRow, context: DueContext) => DueDecision,
  limit = 100
): Promise<readonly ScheduleRunRow[]> =>
  db.transaction(async (tx) => {
    const due = await tx
      .select()
      .from(dotSchedule)
      .where(
        and(
          eq(dotSchedule.enabled, true),
          isNull(dotSchedule.completedAt),
          isNotNull(dotSchedule.nextRunAt),
          lte(dotSchedule.nextRunAt, now)
        )
      )
      .orderBy(asc(dotSchedule.nextRunAt))
      .limit(limit)
      // Not `update`: a Run now claim's foreign key takes `key share` on the
      // row while holding the cap lock the tick is about to wait for.
      .for("no key update", { skipLocked: true });
    if (due.length === 0) {
      return [];
    }
    const targets = due.flatMap((row) =>
      row.conversationId ? [row.conversationId] : []
    );
    const busyRows =
      targets.length === 0
        ? []
        : await tx
            .selectDistinct({ conversationId: run.conversationId })
            .from(run)
            .where(
              and(
                inArray(run.conversationId, targets),
                inArray(run.status, [...ACTIVE_RUN])
              )
            );
    const busy = new Set(busyRows.map((row) => row.conversationId));
    const runsToday = await lockedRunsToday(
      tx,
      due.map((row) => row.ownerId),
      now
    );
    const claims: ScheduleRunRow[] = [];
    for (const schedule of due) {
      const decision = decide(schedule, {
        busy: schedule.conversationId
          ? busy.has(schedule.conversationId)
          : false,
        runsToday: runsToday.get(schedule.ownerId) ?? 0,
      });
      // biome-ignore lint/performance/noAwaitInLoops: one small update per due schedule, inside the claim's transaction.
      await tx
        .update(dotSchedule)
        .set(decision.patch)
        .where(eq(dotSchedule.id, schedule.id));
      if (decision.skip) {
        await tx.insert(dotRun).values({
          ...decision.skip,
          ownerId: schedule.ownerId,
          scheduleId: schedule.id,
        });
      }
      if (decision.fire) {
        runsToday.set(
          schedule.ownerId,
          (runsToday.get(schedule.ownerId) ?? 0) + 1
        );
        claims.push(await insertSlotClaim(tx, schedule, decision.fire, now));
      }
    }
    return claims;
  });

// --- Runs -----------------------------------------------------------------

export const getScheduleRunById = async (
  db: Db,
  id: DotRunId
): Promise<ScheduleRunRow | null> => {
  const [row] = await db.select().from(dotRun).where(eq(dotRun.id, id));
  return row ?? null;
};

export const releaseClaim = async (db: Db, id: DotRunId): Promise<void> => {
  await db.delete(dotRun).where(and(eq(dotRun.id, id), isNull(dotRun.runId)));
};

/** Fails claims no run ever started (a crash, a lost job), so they stop spending the cap. */
export const failStaleClaims = async (db: Db, before: Date): Promise<void> => {
  await db
    .update(dotRun)
    .set({ outcome: "failed" })
    .where(
      and(
        isNull(dotRun.runId),
        isNull(dotRun.outcome),
        isNull(dotRun.skipReason),
        lt(dotRun.createdAt, before)
      )
    );
};

/** The schedule-run row (and its schedule) that started `runId`, if any. */
export const scheduleRunFor = async (
  db: Db,
  runId: RunId
): Promise<{
  readonly run: ScheduleRunRow;
  readonly schedule: ScheduleRow | null;
} | null> => {
  const [row] = await db
    .select({ run: dotRun, schedule: dotSchedule })
    .from(dotRun)
    .leftJoin(dotSchedule, eq(dotSchedule.id, dotRun.scheduleId))
    .where(eq(dotRun.runId, runId));
  return row ?? null;
};

export const updateScheduleRun = async (
  db: Db,
  id: DotRunId,
  patch: ScheduleRunPatch
): Promise<void> => {
  await db.update(dotRun).set(patch).where(eq(dotRun.id, id));
};

/** Each Dot's latest run (skipped slots aside). */
export const latestDotRuns = async (
  db: Db,
  dotIds: readonly DotId[]
): Promise<ScheduleRunView[]> => {
  if (dotIds.length === 0) {
    return [];
  }
  return (await db
    .selectDistinctOn([dotRun.dotId], runView)
    .from(dotRun)
    .innerJoin(run, eq(run.id, dotRun.runId))
    .leftJoin(message, eq(message.id, run.assistantMessageId))
    .where(inArray(dotRun.dotId, [...dotIds]))
    .orderBy(
      dotRun.dotId,
      desc(dotRun.createdAt),
      desc(dotRun.id)
    )) as ScheduleRunView[];
};

/** A Dot's runs, newest first. */
export const listDotRuns = async (
  db: Db,
  dotId: DotId,
  limit: number
): Promise<ScheduleRunView[]> =>
  (await db
    .select(runView)
    .from(dotRun)
    .innerJoin(run, eq(run.id, dotRun.runId))
    .leftJoin(message, eq(message.id, run.assistantMessageId))
    .where(eq(dotRun.dotId, dotId))
    .orderBy(desc(dotRun.createdAt), desc(dotRun.id))
    .limit(limit)) as ScheduleRunView[];

/** A schedule's history, skipped slots included, newest first. */
export const listScheduleRuns = async (
  db: Db,
  scheduleId: DotScheduleId,
  limit: number,
  before?: Date
): Promise<ScheduleRunView[]> =>
  (await db
    .select(runView)
    .from(dotRun)
    .leftJoin(run, eq(run.id, dotRun.runId))
    .leftJoin(message, eq(message.id, run.assistantMessageId))
    .where(
      and(
        eq(dotRun.scheduleId, scheduleId),
        before ? lt(dotRun.createdAt, before) : undefined
      )
    )
    .orderBy(desc(dotRun.createdAt), desc(dotRun.id))
    .limit(limit)) as ScheduleRunView[];

/**
 * Per Dot, the notified runs that finished since its owner last opened it,
 * and whether any of them asks for attention (failed or `needs_attention`).
 * Silent runs never count.
 */
export const unreadDotRuns = async (
  db: Db,
  dotIds: readonly DotId[]
): Promise<
  ReadonlyMap<DotId, { readonly attention: boolean; readonly count: number }>
> => {
  if (dotIds.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({
      attention: sql<boolean>`bool_or(${run.status} = 'failed' or ${dotRun.outcome} in ('needs_attention', 'failed'))`,
      dotId: dotRun.dotId,
      n: count(),
    })
    .from(dotRun)
    .innerJoin(dot, eq(dot.id, dotRun.dotId))
    .innerJoin(run, eq(run.id, dotRun.runId))
    .where(
      and(
        inArray(dotRun.dotId, [...dotIds]),
        eq(dotRun.notified, true),
        isNotNull(run.finishedAt),
        or(
          sql`${dot.lastViewedAt} is null`,
          gt(run.finishedAt, dot.lastViewedAt)
        )
      )
    )
    .groupBy(dotRun.dotId);
  return new Map(
    rows.flatMap((row) =>
      row.dotId
        ? [
            [
              row.dotId,
              { attention: Boolean(row.attention), count: Number(row.n) },
            ] as const,
          ]
        : []
    )
  );
};

export const markScheduleRunsRead = async (
  db: Db,
  scheduleId: DotScheduleId,
  at: Date
): Promise<void> => {
  await db
    .update(dotRun)
    .set({ readAt: at })
    .where(and(eq(dotRun.scheduleId, scheduleId), isNull(dotRun.readAt)));
};

/** Runs the owner started from schedules (or "Run now") in the 24 hours before `now`, claims included. */
export const runsInLastDay = async (
  db: Db,
  ownerId: UserId,
  now: Date
): Promise<number> => {
  const [row] = await db
    .select({ n: count() })
    .from(dotRun)
    .where(
      and(
        eq(dotRun.ownerId, ownerId),
        spendsCap,
        gt(dotRun.createdAt, new Date(now.getTime() - 86_400_000))
      )
    );
  return Number(row?.n ?? 0);
};

export const claimRun = (
  db: Db,
  claim: NewScheduleRun,
  now: Date,
  cap: number
): Promise<ScheduleRunRow | null> =>
  db.transaction(async (tx) => {
    await lockCap(tx, claim.ownerId);
    if ((await runsInLastDay(tx, claim.ownerId, now)) >= cap) {
      return null;
    }
    const [row] = await tx
      .insert(dotRun)
      .values({ ...claim, createdAt: now })
      .returning();
    if (!row) {
      throw new Error("insert returned no row");
    }
    return row;
  });

/** Whether the conversation has a run in flight or waiting on approval. */
export const conversationBusy = async (
  db: Db,
  conversationId: ConversationId
): Promise<boolean> => {
  const [row] = await db
    .select({ id: run.id })
    .from(run)
    .where(
      and(
        eq(run.conversationId, conversationId),
        inArray(run.status, [...ACTIVE_RUN])
      )
    )
    .limit(1);
  return Boolean(row);
};

/** The conversation's newest message: a scheduled run posts after it. */
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
