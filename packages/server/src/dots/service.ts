import type {
  ConversationId,
  DotId,
  DotScheduleId,
  UserId,
} from "@workspace/contract/schemas/common";
import type {
  CreateDotInput,
  CreateDotScheduleInput,
  Dot,
  DotActivity,
  DotActivityInput,
  DotLastRun,
  DotSchedule,
  DotScheduleInput,
  UpdateDotInput,
  UpdateDotScheduleInput,
} from "@workspace/contract/schemas/dots";
import type {
  CreateRunOutput,
  RunStatus,
} from "@workspace/contract/schemas/runs";
import type { SandboxProvider } from "@workspace/contract/schemas/sandbox";
import type { Db } from "@workspace/db/client";
import { createConversation } from "@workspace/db/queries/conversations";
import {
  claimDueDotSchedules,
  type DotLastRunRow,
  type DotRow,
  type DotScheduleRow,
  deleteDot as deleteDotRow,
  deleteDotSchedule,
  dotForRun,
  dotHandleTaken,
  getDot,
  getDotById,
  getDotSchedule,
  getDotScheduleById,
  insertDot,
  insertDotRun,
  insertDotSchedules,
  latestDotRuns,
  latestMessageId,
  listDotHandles,
  listDotRuns,
  listDotSchedules,
  listDots,
  markDotViewed,
  promoteNewestDot,
  recentScheduleStatuses,
  setDotScheduleStatus,
  setPrimaryDot,
  unreadDotRunCounts,
  updateDot as updateDotRow,
  updateDotSchedule,
} from "@workspace/db/queries/dots";
import { loadPrincipals } from "@workspace/db/queries/teams";
import { newId } from "@workspace/shared/ids";
import { err, ok, type Result } from "@workspace/shared/result";

import type { Actor } from "../context";
import { storeContext } from "../runs/chat-context";
import {
  type CreateRunDeps,
  type CreateRunError,
  createRun,
} from "../runs/create-run";
import {
  AUTO_PAUSE_AFTER_FAILURES,
  type CronError,
  DEFAULT_DOT_PROMPT,
  dotRunKey,
  dotStatusOf,
  handleFrom,
  isActiveRun,
  isUnread,
  nextFor,
  nextRunAt,
  shouldAutoPause,
  snippetOf,
} from "./policy";

// The Dots shell (172): the API handlers and the jobs call these. Each takes
// its ports as arguments and returns a `Result`; nothing here throws on a
// user error.

export type DotError =
  | { readonly type: "not_found" }
  | { readonly type: "no_personal_space" }
  | { readonly type: "handle_taken" }
  | (CronError & { readonly path: readonly (string | number)[] })
  | { readonly error: CreateRunError; readonly type: "run" };

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

export interface DotDeps {
  readonly db: Db;
  readonly ensureWorkspace?: EnsureDotWorkspace;
  readonly now: () => Date;
  readonly runs: CreateRunDeps;
}

const iso = (date: Date | null): string | null =>
  date ? date.toISOString() : null;

export const toDotSchedule = (row: DotScheduleRow): DotSchedule => ({
  createdAt: row.createdAt.toISOString(),
  cron: row.cron,
  dotId: row.dotId,
  enabled: row.enabled,
  id: row.id,
  lastRunAt: iso(row.lastRunAt),
  lastStatus: row.lastStatus ?? null,
  nextRunAt: iso(row.nextRunAt),
  prompt: row.prompt,
  timezone: row.timezone,
  updatedAt: row.updatedAt.toISOString(),
});

const RUN_ERROR_MESSAGE = "The run failed.";

export const toDotLastRun = (row: DotLastRunRow): DotLastRun => ({
  error:
    row.status === "failed"
      ? (row.error?.message ?? RUN_ERROR_MESSAGE).slice(0, 2000)
      : null,
  finishedAt: iso(row.finishedAt),
  runId: row.runId,
  scheduleId: row.scheduleId,
  snippet: snippetOf(row.replyParts),
  startedAt: (row.startedAt ?? row.createdAt).toISOString(),
  status: row.status,
  trigger: row.trigger,
});

/** The contract's `Dot` from its rows. Pure. */
export const toDot = (
  row: DotRow,
  schedules: readonly DotScheduleRow[],
  last: DotLastRunRow | undefined,
  unreadRuns = 0
): Dot => {
  const lastRun = last ? toDotLastRun(last) : null;
  const upcoming = row.enabled
    ? schedules
        .filter((schedule) => schedule.enabled && schedule.nextRunAt)
        .map((schedule) => schedule.nextRunAt?.getTime() ?? 0)
    : [];
  return {
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
    primary: row.primary,
    rules: row.rules,
    sandboxProvider: row.sandboxProvider ?? null,
    schedules: schedules.map(toDotSchedule),
    status: dotStatusOf(lastRun),
    target: row.target,
    unread: isUnread(lastRun, row.lastViewedAt),
    unreadRuns,
    updatedAt: row.updatedAt.toISOString(),
  };
};

const hydrate = async (db: Db, rows: readonly DotRow[]): Promise<Dot[]> => {
  const ids = rows.map((row) => row.id);
  const [schedules, last, unread] = await Promise.all([
    listDotSchedules(db, ids),
    latestDotRuns(db, ids),
    unreadDotRunCounts(db, ids),
  ]);
  return rows.map((row) =>
    toDot(
      row,
      schedules.filter((schedule) => schedule.dotId === row.id),
      last.find((run) => run.dotId === row.id),
      unread.get(row.id) ?? 0
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

/** A schedule's next firing, or the error with where it is in the input. */
const checkSchedule = (
  schedule: Pick<DotScheduleInput, "cron" | "timezone">,
  now: Date,
  path: readonly (string | number)[]
): Result<Date, DotError> => {
  const next = nextRunAt(schedule.cron, schedule.timezone, now);
  if (next.ok) {
    return next;
  }
  const field = next.error.type === "invalid_timezone" ? "timezone" : "cron";
  return err({ ...next.error, path: [...path, field] });
};

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

export const createDot = async (
  deps: DotDeps,
  actor: Actor,
  input: CreateDotInput
): Promise<Result<Dot, DotError>> => {
  const { db } = deps;
  const now = deps.now();
  const firstRuns: Date[] = [];
  for (const [index, schedule] of input.schedules.entries()) {
    const next = checkSchedule(schedule, now, ["schedules", index]);
    if (!next.ok) {
      return next;
    }
    firstRuns.push(next.value);
  }
  const context = await storeContext(db, actor, { type: "personal" });
  if (!context.ok) {
    return err({ type: "no_personal_space" });
  }
  const handles = await listDotHandles(db, actor.userId);
  if (input.handle && handles.includes(input.handle)) {
    return err({ type: "handle_taken" });
  }
  const handle = input.handle ?? handleFrom(input.name, handles);
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
  await insertDotSchedules(
    db,
    input.schedules.map((schedule, index) => ({
      cron: schedule.cron,
      dotId: inserted.id,
      enabled: schedule.enabled,
      nextRunAt: schedule.enabled ? (firstRuns[index] ?? null) : null,
      prompt: schedule.prompt,
      timezone: schedule.timezone,
    }))
  );
  // The first Dot is the primary one; asking for it moves the mark here.
  const makePrimary = input.primary || handles.length === 0;
  const row =
    makePrimary && (await setPrimaryDot(db, inserted.id, actor.userId))
      ? await getDot(db, inserted.id, actor.userId)
      : inserted;
  return ok(await one(db, row ?? inserted));
};

export const updateDot = async (
  deps: DotDeps,
  actor: Actor,
  input: UpdateDotInput
): Promise<Result<Dot, DotError>> => {
  const { avatar, id, primary, ...rest } = input;
  if (
    rest.handle &&
    (await dotHandleTaken(deps.db, actor.userId, rest.handle, id))
  ) {
    return err({ type: "handle_taken" });
  }
  if (primary && !(await setPrimaryDot(deps.db, id, actor.userId))) {
    return err({ type: "not_found" });
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
): Promise<Result<void, DotError>> => {
  if (!(await deleteDotRow(db, id, actor.userId))) {
    return err({ type: "not_found" });
  }
  await promoteNewestDot(db, actor.userId);
  return ok(undefined);
};

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

/** One Dot's schedules, for its own `manage_scheduled_tasks` tool. */
export const scheduleDotsListFor = async (
  db: Db,
  dotId: DotId
): Promise<DotSchedule[]> =>
  (await listDotSchedules(db, [dotId])).map(toDotSchedule);

export const markDotRead = async (
  deps: Pick<DotDeps, "db" | "now">,
  actor: Actor,
  id: DotId
): Promise<Result<Dot, DotError>> => {
  const row = await markDotViewed(deps.db, id, actor.userId, deps.now());
  return row ? ok(await one(deps.db, row)) : err({ type: "not_found" });
};

export const addDotSchedule = async (
  deps: Pick<DotDeps, "db" | "now">,
  actor: Actor,
  input: CreateDotScheduleInput
): Promise<Result<DotSchedule, DotError>> => {
  const dot = await getDot(deps.db, input.dotId, actor.userId);
  if (!dot) {
    return err({ type: "not_found" });
  }
  const next = checkSchedule(input, deps.now(), []);
  if (!next.ok) {
    return next;
  }
  const [row] = await insertDotSchedules(deps.db, [
    {
      cron: input.cron,
      dotId: dot.id,
      enabled: input.enabled,
      nextRunAt: input.enabled ? next.value : null,
      prompt: input.prompt,
      timezone: input.timezone,
    },
  ]);
  return row ? ok(toDotSchedule(row)) : err({ type: "not_found" });
};

export const editDotSchedule = async (
  deps: Pick<DotDeps, "db" | "now">,
  actor: Actor,
  input: UpdateDotScheduleInput
): Promise<Result<DotSchedule, DotError>> => {
  const found = await getDotSchedule(deps.db, input.id, actor.userId);
  if (!found) {
    return err({ type: "not_found" });
  }
  const merged = {
    cron: input.cron ?? found.schedule.cron,
    enabled: input.enabled ?? found.schedule.enabled,
    timezone: input.timezone ?? found.schedule.timezone,
  };
  const next = checkSchedule(merged, deps.now(), []);
  if (!next.ok) {
    return next;
  }
  const row = await updateDotSchedule(deps.db, input.id, {
    ...merged,
    nextRunAt: merged.enabled ? next.value : null,
    ...(input.prompt === undefined ? {} : { prompt: input.prompt }),
  });
  return row ? ok(toDotSchedule(row)) : err({ type: "not_found" });
};

export const removeDotSchedule = async (
  db: Db,
  actor: Actor,
  id: DotScheduleId
): Promise<Result<void, DotError>> => {
  const found = await getDotSchedule(db, id, actor.userId);
  if (!found) {
    return err({ type: "not_found" });
  }
  await deleteDotSchedule(db, id);
  return ok(undefined);
};

/** Who the Dot runs as: its owner, with their teams and orgs, read now. */
export const ownerActor = async (db: Db, userId: UserId): Promise<Actor> => ({
  principals: await loadPrincipals(db, userId),
  userId,
});

export type DotTrigger =
  | {
      readonly occurrence: Date;
      readonly scheduleId: DotScheduleId;
      readonly type: "schedule";
    }
  | { readonly type: "manual" };

/**
 * Posts `prompt` into the Dot's conversation as its owner and starts the
 * run. `createRun` re-checks that the owner may still write there and use
 * the agent, so a revoked share or agent fails the run cleanly.
 */
export const startDotRun = async (
  deps: DotDeps,
  dot: DotRow,
  prompt: string,
  trigger: DotTrigger
): Promise<Result<CreateRunOutput, DotError>> => {
  const { db } = deps;
  const actor = await ownerActor(db, dot.ownerId);
  if (dot.sandboxProvider && deps.ensureWorkspace) {
    await deps.ensureWorkspace(actor, dot.conversationId, dot.sandboxProvider);
  }
  const created = await createRun(deps.runs, actor, {
    conversationId: dot.conversationId,
    idempotencyKey: dotRunKey(
      trigger.type === "schedule"
        ? { ...trigger, type: "schedule" }
        : { nonce: newId("job"), type: "manual" }
    ),
    input: {
      parentId: await latestMessageId(db, dot.conversationId),
      parts: [{ text: prompt, type: "text" }],
      type: "message",
    },
    target: dot.target,
  });
  if (!created.ok) {
    return err({ error: created.error, type: "run" });
  }
  await insertDotRun(db, {
    dotId: dot.id,
    runId: created.value.runId,
    scheduleId: trigger.type === "schedule" ? trigger.scheduleId : null,
    trigger: trigger.type,
  });
  return created;
};

export const runDotNow = async (
  deps: DotDeps,
  actor: Actor,
  input: { readonly id: DotId; readonly prompt?: string }
): Promise<Result<CreateRunOutput, DotError>> => {
  const dot = await getDot(deps.db, input.id, actor.userId);
  if (!dot) {
    return err({ type: "not_found" });
  }
  const [first] = await listDotSchedules(deps.db, [dot.id]);
  return startDotRun(
    deps,
    dot,
    input.prompt ?? first?.prompt ?? DEFAULT_DOT_PROMPT,
    { type: "manual" }
  );
};

/** What a fired schedule did: a run, or why it didn't start one. */
export type FireOutcome =
  | { readonly runId: string; readonly type: "started" }
  | {
      readonly reason: "busy" | "disabled" | "gone" | "run_failed";
      readonly type: "skipped";
    };

/**
 * Fires one claimed occurrence (the `dot.run` job). Skips quietly when the
 * schedule or Dot was removed or paused since the claim, or when the Dot's
 * last run is still going: a slow run is never stacked behind by its own
 * schedule.
 */
export const fireDotSchedule = async (
  deps: DotDeps,
  data: { readonly occurrence: string; readonly scheduleId: DotScheduleId }
): Promise<FireOutcome> => {
  const { db } = deps;
  const schedule = await getDotScheduleById(db, data.scheduleId);
  const dot = schedule ? await getDotById(db, schedule.dotId) : null;
  if (!(schedule && dot)) {
    return { reason: "gone", type: "skipped" };
  }
  if (!(schedule.enabled && dot.enabled)) {
    return { reason: "disabled", type: "skipped" };
  }
  const [last] = await latestDotRuns(db, [dot.id]);
  if (last && isActiveRun(last.status)) {
    return { reason: "busy", type: "skipped" };
  }
  const started = await startDotRun(deps, dot, schedule.prompt, {
    occurrence: new Date(data.occurrence),
    scheduleId: schedule.id,
    type: "schedule",
  });
  if (!started.ok) {
    await setDotScheduleStatus(db, schedule.id, "failed");
    return { reason: "run_failed", type: "skipped" };
  }
  return { runId: started.value.runId, type: "started" };
};

/** The tick: claims due schedules and hands back each occurrence to fire. */
export const claimDue = async (
  db: Db,
  now: Date
): Promise<
  readonly { readonly occurrence: string; readonly scheduleId: DotScheduleId }[]
> => {
  const claimed = await claimDueDotSchedules(db, now, (schedule) =>
    nextFor(schedule, now)
  );
  return claimed.map((schedule) => ({
    occurrence: (schedule.nextRunAt ?? now).toISOString(),
    scheduleId: schedule.id,
  }));
};

/**
 * After any run settles: if a Dot's schedule started it, record how it
 * ended, and pause the schedule after repeated failures.
 */
export const settleDotRun = async (
  db: Db,
  runId: Parameters<typeof dotForRun>[1],
  status: RunStatus
): Promise<void> => {
  const found = await dotForRun(db, runId);
  if (!found?.scheduleId) {
    return;
  }
  await setDotScheduleStatus(db, found.scheduleId, status);
  if (status !== "failed") {
    return;
  }
  const recent = await recentScheduleStatuses(
    db,
    found.scheduleId,
    AUTO_PAUSE_AFTER_FAILURES
  );
  if (shouldAutoPause(recent)) {
    await updateDotSchedule(db, found.scheduleId, {
      enabled: false,
      nextRunAt: null,
    });
  }
};
