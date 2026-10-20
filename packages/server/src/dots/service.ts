import { SCHEDULED_TASK_DATA } from "@workspace/ai/schedules/tool";
import type {
  ConversationId,
  DotId,
  UserId,
} from "@workspace/contract/schemas/common";
import type {
  CreateDotInput,
  Dot,
  DotActivity,
  DotActivityInput,
  DotLastRun,
  DotScheduleInput,
  UpdateDotInput,
} from "@workspace/contract/schemas/dots";
import type { CreateRunOutput } from "@workspace/contract/schemas/runs";
import type { SandboxProvider } from "@workspace/contract/schemas/sandbox";
import type {
  Schedule,
  ScheduleRecurrence,
} from "@workspace/contract/schemas/schedules";
import type { Db } from "@workspace/db/client";
import { createConversation } from "@workspace/db/queries/conversations";
import {
  type DotRow,
  deleteDot as deleteDotRow,
  dotHandleTaken,
  getDot,
  getOwnersDot,
  insertDot,
  insertScheduleRun,
  latestDotRuns,
  latestMessageId,
  listDotRuns,
  listDotSchedules,
  listDots,
  markDotViewed,
  type ScheduleRow,
  type ScheduleRunView,
  unreadDotRuns,
  updateDot as updateDotRow,
} from "@workspace/db/queries/dots";
import { newId } from "@workspace/shared/ids";
import { err, ok, type Result } from "@workspace/shared/result";

import type { Actor } from "../context";
import { storeContext } from "../runs/chat-context";
import { createUnattendedRun } from "../runs/create-run";
import {
  DEFAULT_DOT_PROMPT,
  dotRunKey,
  dotStatusOf,
  handleFrom,
  isUnread,
} from "./policy";
import { toSchedule } from "./schedule-policy";
import {
  capCheck,
  createSchedule,
  ownerActor,
  type ScheduleDeps,
  type ScheduleError,
  toScheduleRun,
} from "./schedules";

// The Dots shell (172, 174): one Dot per user, and the Dot is a thread.
// Its schedules are ordinary schedules (173) targeting that thread; the
// `dots.*Schedule` handlers here are aliases over `schedules`. Each takes
// its ports as arguments and returns a `Result`; nothing here throws on a
// user error.

export type DotError =
  | ScheduleError
  | { readonly type: "handle_taken" }
  | { readonly type: "dot_exists" };

/**
 * Makes sure the Dot's conversation has its workspace on the Dot's provider
 * before the first run, so `ensureWorkspace` keeps that provider. Optional:
 * without it, the run's tools create the instance default on first use.
 */
export type EnsureDotWorkspace = (
  actor: Actor,
  conversationId: ConversationId,
  provider: SandboxProvider
) => Promise<void>;

export interface DotDeps extends ScheduleDeps {
  readonly ensureWorkspace?: EnsureDotWorkspace;
}

const iso = (date: Date | null): string | null =>
  date ? date.toISOString() : null;

export const toDotLastRun = (row: ScheduleRunView): DotLastRun => {
  const run = toScheduleRun(row);
  // Dot activity joins the run row, so a skipped slot never shows here.
  if (run.outcome === "skipped") {
    throw new Error(`dot_run ${row.id} is a skipped slot, not a Dot run`);
  }
  return {
    error: run.error,
    finishedAt: run.finishedAt,
    outcome: run.outcome,
    runId: run.runId,
    scheduleId: run.scheduleId,
    snippet: run.summary,
    startedAt: (row.startedAt ?? row.createdAt).toISOString(),
    status: run.status,
    trigger: row.trigger,
  };
};

/** The contract's `Dot` from its rows. Pure. */
export const toDot = (
  row: DotRow,
  schedules: readonly ScheduleRow[],
  last: ScheduleRunView | undefined,
  unread: { readonly attention: boolean; readonly count: number } = {
    attention: false,
    count: 0,
  }
): Dot => {
  const lastRun = last ? toDotLastRun(last) : null;
  const shaped = schedules.map(toSchedule);
  const upcoming = row.enabled
    ? shaped.flatMap((schedule) =>
        schedule.nextRunNominalAt
          ? [new Date(schedule.nextRunNominalAt).getTime()]
          : []
      )
    : [];
  return {
    attention: unread.attention,
    autoApproveTools: row.autoApproveTools,
    avatar: { color: row.avatarColor, style: row.avatarStyle },
    conversationId: row.conversationId,
    createdAt: row.createdAt.toISOString(),
    enabled: row.enabled,
    handle: row.handle,
    id: row.id,
    instructions: row.instructions,
    lastRun,
    lastViewedAt: iso(row.lastViewedAt),
    name: row.name,
    nextRunAt:
      upcoming.length > 0
        ? new Date(Math.min(...upcoming)).toISOString()
        : null,
    ownerId: row.ownerId,
    primary: true,
    rules: row.rules,
    sandboxProvider: row.sandboxProvider ?? null,
    schedules: shaped,
    status: dotStatusOf(lastRun),
    target: row.target,
    unread: unread.count > 0 && isUnread(lastRun, row.lastViewedAt),
    unreadRuns: unread.count,
    updatedAt: row.updatedAt.toISOString(),
  };
};

const hydrate = async (db: Db, rows: readonly DotRow[]): Promise<Dot[]> => {
  const ids = rows.map((row) => row.id);
  const [schedules, last, unread] = await Promise.all([
    listDotSchedules(db, ids),
    latestDotRuns(db, ids),
    unreadDotRuns(db, ids),
  ]);
  return rows.map((row) =>
    toDot(
      row,
      schedules.filter((schedule) => schedule.dotId === row.id),
      last.find((run) => run.dotId === row.id),
      unread.get(row.id)
    )
  );
};

const one = async (db: Db, row: DotRow): Promise<Dot> => {
  const [dot] = await hydrate(db, [row]);
  if (!dot) {
    throw new Error("hydrate dropped a row");
  }
  return dot;
};

/** A 172 cron schedule input as a recurrence. */
const cronRecurrence = (
  schedule: Pick<DotScheduleInput, "cron" | "timezone">
): ScheduleRecurrence => ({
  cron: schedule.cron,
  endsAt: null,
  kind: "cron",
  timezone: schedule.timezone,
});

const titleFrom = (prompt: string): string =>
  prompt.replace(/\s+/g, " ").trim().slice(0, 60) || "Scheduled task";

export const listDotsFor = async (db: Db, ownerId: UserId): Promise<Dot[]> =>
  hydrate(db, await listDots(db, ownerId));

export const getDotFor = async (
  db: Db,
  ownerId: UserId,
  id: DotId
): Promise<Result<Dot, DotError>> => {
  const row = await getDot(db, id, ownerId);
  return row ? ok(await one(db, row)) : err({ type: "not_found" });
};

/**
 * Makes the caller's Dot, with its conversation and starter schedules. An
 * owner has one Dot (174): a second is `dot_exists`.
 */
export const createDot = async (
  deps: DotDeps,
  actor: Actor,
  input: CreateDotInput
): Promise<Result<Dot, DotError>> => {
  const { db } = deps;
  if (await getOwnersDot(db, actor.userId)) {
    return err({ type: "dot_exists" });
  }
  const context = await storeContext(db, actor, { type: "personal" });
  if (!context.ok) {
    return err({ type: "no_personal_space" });
  }
  const handle = input.handle ?? handleFrom(input.name, []);
  const conversation = await createConversation(db, {
    context: context.value,
    defaultTarget: input.target,
    ownerId: actor.userId,
    title: input.name,
  });
  const inserted = await insertDot(db, {
    autoApproveTools: [...input.autoApproveTools],
    avatarColor: input.avatar.color,
    avatarStyle: input.avatar.style,
    conversationId: conversation.id,
    enabled: input.enabled,
    handle,
    instructions: input.instructions,
    name: input.name,
    ownerId: actor.userId,
    rules: input.rules,
    sandboxProvider: input.sandboxProvider,
    target: input.target,
  });
  if (!inserted) {
    // Lost a race with another tab making the same owner's Dot.
    return err({ type: "dot_exists" });
  }
  for (const [index, schedule] of input.schedules.entries()) {
    // biome-ignore lint/performance/noAwaitInLoops: a starter template has one or two schedules.
    const made = await createSchedule(deps, actor, {
      autoApproveTools: [],
      missedRunPolicy: "run_once",
      notify: "all",
      paused: !schedule.enabled,
      prompt: schedule.prompt,
      recurrence: cronRecurrence(schedule),
      target: { kind: "dot" },
      title: titleFrom(schedule.prompt),
    });
    if (!made.ok) {
      await deleteDotRow(db, inserted.id, actor.userId);
      return "path" in made.error
        ? err({ ...made.error, path: ["schedules", index, ...made.error.path] })
        : made;
    }
  }
  return ok(await one(db, inserted));
};

export const updateDot = async (
  deps: DotDeps,
  actor: Actor,
  input: UpdateDotInput
): Promise<Result<Dot, DotError>> => {
  const { avatar, id, primary: _primary, ...rest } = input;
  if (
    rest.handle &&
    (await dotHandleTaken(deps.db, actor.userId, rest.handle, id))
  ) {
    return err({ type: "handle_taken" });
  }
  const row = await updateDotRow(deps.db, id, actor.userId, {
    ...rest,
    ...(avatar ? { avatarColor: avatar.color, avatarStyle: avatar.style } : {}),
  });
  return row ? ok(await one(deps.db, row)) : err({ type: "not_found" });
};

export const deleteDot = async (
  db: Db,
  actor: Actor,
  id: DotId
): Promise<Result<void, DotError>> =>
  (await deleteDotRow(db, id, actor.userId))
    ? ok(undefined)
    : err({ type: "not_found" });

/** The runs the Dot started, newest first, for its Activity tab. */
export const listDotActivity = async (
  db: Db,
  ownerId: UserId,
  input: DotActivityInput
): Promise<Result<DotActivity[], DotError>> => {
  const dot = await getDot(db, input.id, ownerId);
  if (!dot) {
    return err({ type: "not_found" });
  }
  const rows = await listDotRuns(db, dot.id, input.limit);
  return ok(rows.map(toDotLastRun));
};

/** The Dot's schedules, for its own `manage_scheduled_tasks` tool. */
export const scheduleDotsListFor = async (
  db: Db,
  dotId: DotId
): Promise<Schedule[]> => (await listDotSchedules(db, [dotId])).map(toSchedule);

export const markDotRead = async (
  deps: Pick<DotDeps, "db" | "now">,
  actor: Actor,
  id: DotId
): Promise<Result<Dot, DotError>> => {
  const row = await markDotViewed(deps.db, id, actor.userId, deps.now());
  return row ? ok(await one(deps.db, row)) : err({ type: "not_found" });
};

/**
 * "Check in now": posts `prompt` into the Dot's thread as its owner and
 * starts an unattended run, outside any schedule. Counts toward the cap.
 */
export const runDotNow = async (
  deps: DotDeps,
  actor: Actor,
  input: { readonly id: DotId; readonly prompt?: string }
): Promise<Result<CreateRunOutput, DotError>> => {
  const { db } = deps;
  const dot = await getDot(db, input.id, actor.userId);
  if (!dot) {
    return err({ type: "not_found" });
  }
  const cap = await capCheck(deps, actor.userId);
  if (!cap.ok) {
    return cap;
  }
  const [first] = await listDotSchedules(db, [dot.id]);
  const owner = await ownerActor(db, dot.ownerId);
  if (dot.sandboxProvider && deps.ensureWorkspace) {
    await deps.ensureWorkspace(owner, dot.conversationId, dot.sandboxProvider);
  }
  const created = await createUnattendedRun(
    deps.runs,
    owner,
    {
      conversationId: dot.conversationId,
      idempotencyKey: dotRunKey({ nonce: newId("job"), type: "manual" }),
      input: {
        parentId: await latestMessageId(db, dot.conversationId),
        parts: [
          {
            data: { scheduleId: null, title: "Check in" },
            name: SCHEDULED_TASK_DATA,
            type: "data",
          },
          {
            text: input.prompt ?? first?.prompt ?? DEFAULT_DOT_PROMPT,
            type: "text",
          },
        ],
        type: "message",
      },
      target: dot.target,
    },
    { type: "check_in" }
  );
  if (!created.ok) {
    return err({ error: created.error, type: "run" });
  }
  await insertScheduleRun(db, {
    conversationId: dot.conversationId,
    dotId: dot.id,
    notified: false,
    ownerId: dot.ownerId,
    runId: created.value.runId,
    scheduleId: null,
    trigger: "manual",
  });
  return created;
};

/** The owner's Dot conversation, for "is this run in the Dot's thread". */
export const dotConversationOf = async (
  db: Db,
  ownerId: UserId
): Promise<ConversationId | null> =>
  (await getOwnersDot(db, ownerId))?.conversationId ?? null;
