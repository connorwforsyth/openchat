import { nextNominal } from "@workspace/ai/schedules/recurrence";
import { SCHEDULED_TASK_DATA } from "@workspace/ai/schedules/tool";
import type {
  ConversationId,
  DotRunId,
  DotScheduleId,
  UserId,
} from "@workspace/contract/schemas/common";
import type { ModelSelector } from "@workspace/contract/schemas/models";
import type {
  CreateRunOutput,
  RunStatus,
  RunTarget,
} from "@workspace/contract/schemas/runs";
import type {
  CreateScheduleInput,
  ListSchedulesInput,
  Schedule,
  ScheduleLimits,
  ScheduleRecurrence,
  ScheduleRun,
  ScheduleRunsInput,
  UpdateScheduleInput,
} from "@workspace/contract/schemas/schedules";
import type { Db } from "@workspace/db/client";
import {
  createConversation,
  deleteConversation,
  getConversation,
} from "@workspace/db/queries/conversations";
import {
  claimDueSchedules,
  claimRun,
  conversationBusy,
  type DotRow,
  deleteSchedule as deleteScheduleRow,
  getDotById,
  getOwnersDot,
  getSchedule,
  getScheduleById,
  getScheduleRunById,
  insertSchedules,
  latestMessageId,
  listScheduleRuns,
  listSchedules,
  markScheduleRunsRead,
  type NewScheduleRun,
  recentScheduleStatuses,
  releaseClaim,
  releaseStaleClaims,
  runsInLastDay,
  type ScheduleRow,
  type ScheduleRunRow,
  type ScheduleRunView,
  scheduleRunFor,
  updateSchedule as updateScheduleRow,
  updateScheduleRun,
} from "@workspace/db/queries/dots";
import { getMessage } from "@workspace/db/queries/messages";
import { getRun } from "@workspace/db/queries/runs";
import { loadPrincipals } from "@workspace/db/queries/teams";
import { newId } from "@workspace/shared/ids";
import { err, ok, type Result } from "@workspace/shared/result";

import type { Actor, ConversationAccess } from "../context";
import { storeContext } from "../runs/chat-context";
import {
  type CreateRunDeps,
  type CreateRunError,
  createUnattendedRun,
} from "../runs/create-run";
import {
  AUTO_PAUSE_AFTER_FAILURES,
  dotRunKey,
  shouldAutoPause,
  snippetOf,
} from "./policy";
import {
  CLAIM_STALE_MS,
  checkRecurrence,
  concludeRun,
  nextColumns,
  planDue,
  type RecurrenceCheckError,
  recurrenceColumns,
  recurrenceOf,
  type ScheduleLimitsConfig,
  shouldNotify,
  statusOf,
  toSchedule,
} from "./schedule-policy";

// The schedules shell (173, 175): the API handlers, the Dot's own tools and
// the jobs call these. Each takes its ports as arguments and returns a
// `Result`; nothing here throws on a user error.

export type ScheduleError =
  | { readonly type: "not_found" }
  | { readonly type: "no_dot" }
  | { readonly type: "forbidden" }
  | { readonly type: "no_personal_space" }
  | { readonly type: "completed" }
  | { readonly type: "target_archived" }
  | { readonly type: "busy" }
  | { readonly retryAfterSeconds: number; readonly type: "cap" }
  | RecurrenceCheckError
  | { readonly error: CreateRunError; readonly type: "run" };

export interface ScheduleDeps {
  readonly access: ConversationAccess;
  readonly db: Db;
  /** The model a schedule on an ordinary chat answers with (175). */
  readonly defaultModel: ModelSelector | null;
  readonly limits: ScheduleLimitsConfig;
  readonly now: () => Date;
  readonly runs: CreateRunDeps;
}

/** Who a schedule runs as: its owner, with their teams and orgs, read now. */
export const ownerActor = async (db: Db, userId: UserId): Promise<Actor> => ({
  principals: await loadPrincipals(db, userId),
  userId,
});

const iso = (date: Date | null): string | null =>
  date ? date.toISOString() : null;

const RUN_ERROR_MESSAGE = "The run failed.";

export const toScheduleRun = (row: ScheduleRunView): ScheduleRun => {
  const fields = {
    conversationId: row.conversationId,
    createdAt: row.createdAt.toISOString(),
    id: row.id,
    missedSlots: row.missedSlots,
    nominalAt: iso(row.nominalAt),
    notified: row.notified,
    readAt: iso(row.readAt),
    scheduleId: row.scheduleId,
    trigger:
      row.trigger === "schedule"
        ? ("scheduled" as const)
        : ("run_now" as const),
  };
  if (row.outcome === "skipped" && row.skipReason) {
    return { ...fields, outcome: "skipped", skipReason: row.skipReason };
  }
  if (row.outcome === "skipped" || !row.runId || !row.status) {
    throw new Error(`dot_run ${row.id} is neither a run nor a skipped slot`);
  }
  return {
    ...fields,
    error:
      row.status === "failed"
        ? (row.error?.message ?? RUN_ERROR_MESSAGE).slice(0, 2000)
        : null,
    finishedAt: iso(row.finishedAt),
    outcome: row.outcome,
    runId: row.runId,
    status: row.status,
    summary: (row.summary ?? snippetOf(row.replyParts))?.slice(0, 500) ?? null,
  };
};

export const isArchived = async (
  db: Db,
  actor: Actor,
  conversationId: ConversationId
): Promise<boolean> => {
  const found = await getConversation(db, conversationId, actor);
  return found.ok && found.value.archivedAt !== null;
};

/** Where a schedule's runs land, checked for the owner. */
const resolveTarget = async (
  deps: Pick<ScheduleDeps, "access" | "db">,
  actor: Actor,
  target: CreateScheduleInput["target"]
): Promise<
  Result<
    {
      readonly conversationId: ConversationId | null;
      readonly dotId: DotRow["id"] | null;
    },
    ScheduleError
  >
> => {
  switch (target.kind) {
    case "dot": {
      const dot = await getOwnersDot(deps.db, actor.userId);
      if (!dot) {
        return err({ type: "no_dot" });
      }
      return (await isArchived(deps.db, actor, dot.conversationId))
        ? err({ type: "target_archived" })
        : ok({ conversationId: dot.conversationId, dotId: dot.id });
    }
    case "conversation": {
      if (!(await deps.access(actor, target.conversationId, "write"))) {
        return err(
          (await deps.access(actor, target.conversationId, "read"))
            ? { type: "forbidden" }
            : { type: "not_found" }
        );
      }
      return (await isArchived(deps.db, actor, target.conversationId))
        ? err({ type: "target_archived" })
        : ok({ conversationId: target.conversationId, dotId: null });
    }
    case "new_chat_each_run":
      return ok({ conversationId: null, dotId: null });
    default:
      return target satisfies never;
  }
};

export const listSchedulesFor = async (
  db: Db,
  ownerId: UserId,
  input: ListSchedulesInput
): Promise<Schedule[]> =>
  (await listSchedules(db, ownerId, input)).map(toSchedule);

export const getScheduleFor = async (
  db: Db,
  ownerId: UserId,
  id: DotScheduleId
): Promise<Result<Schedule, ScheduleError>> => {
  const row = await getSchedule(db, id, ownerId);
  return row ? ok(toSchedule(row)) : err({ type: "not_found" });
};

/** What creating or editing a schedule needs (no run machinery). */
export type ScheduleEditDeps = Pick<
  ScheduleDeps,
  "access" | "db" | "limits" | "now"
>;

export const createSchedule = async (
  deps: ScheduleEditDeps,
  actor: Actor,
  input: CreateScheduleInput
): Promise<Result<Schedule, ScheduleError>> => {
  const now = deps.now();
  const first = checkRecurrence(input.recurrence, now, deps.limits);
  if (!first.ok) {
    return first;
  }
  const target = await resolveTarget(deps, actor, input.target);
  if (!target.ok) {
    return target;
  }
  const id = newId("dotSchedule");
  const active = !input.paused && first.value !== null;
  const [row] = await insertSchedules(deps.db, [
    {
      ...recurrenceColumns(input.recurrence),
      ...(active
        ? nextColumns(id, input.recurrence, first.value)
        : { nextRunAt: null, nextRunNominalAt: null }),
      autoApproveTools: [...input.autoApproveTools],
      conversationId: target.value.conversationId,
      dotId: target.value.dotId,
      enabled: active,
      id,
      missedRunPolicy: input.missedRunPolicy,
      notify: input.notify,
      ownerId: actor.userId,
      pausedReason: active ? null : "user",
      prompt: input.prompt,
      readOnly: input.readOnly ?? input.target.kind !== "dot",
      targetKind: input.target.kind,
      title: input.title,
    },
  ]);
  return row ? ok(toSchedule(row)) : err({ type: "not_found" });
};

/** The timing columns for a schedule's new rule, or why it can't take it. */
const timingColumns = (
  deps: ScheduleEditDeps,
  found: ScheduleRow,
  recurrence: ScheduleRecurrence
) => {
  const first = checkRecurrence(recurrence, deps.now(), deps.limits);
  if (!first.ok) {
    return first;
  }
  const active = statusOf(found) !== "paused" && first.value !== null;
  return ok({
    ...recurrenceColumns(recurrence),
    ...(active
      ? nextColumns(found.id, recurrence, first.value)
      : { nextRunAt: null, nextRunNominalAt: null }),
    // A new rule revives a completed one-off.
    completedAt: null,
    enabled: active,
    pausedReason: active ? null : (found.pausedReason ?? "user"),
  });
};

/** The plain fields an edit sets, leaving out the ones it doesn't mention. */
const editColumns = (input: UpdateScheduleInput) => ({
  ...(input.autoApproveTools
    ? { autoApproveTools: [...input.autoApproveTools] }
    : {}),
  ...(input.missedRunPolicy ? { missedRunPolicy: input.missedRunPolicy } : {}),
  ...(input.notify ? { notify: input.notify } : {}),
  ...(input.prompt === undefined ? {} : { prompt: input.prompt }),
  ...(input.readOnly === undefined ? {} : { readOnly: input.readOnly }),
  ...(input.title === undefined ? {} : { title: input.title }),
});

/** A Dot runs as itself; a plain schedule falls back to the default model. */
const runTargetOf = (
  dot: { readonly target: RunTarget } | null,
  defaultModel: ModelSelector | null
): RunTarget | undefined => {
  if (dot) {
    return dot.target;
  }
  return defaultModel ? { model: defaultModel, type: "model" } : undefined;
};

export const updateSchedule = async (
  deps: ScheduleEditDeps,
  actor: Actor,
  input: UpdateScheduleInput
): Promise<Result<Schedule, ScheduleError>> => {
  const found = await getSchedule(deps.db, input.id, actor.userId);
  if (!found) {
    return err({ type: "not_found" });
  }
  const target = input.target
    ? await resolveTarget(deps, actor, input.target)
    : null;
  if (target && !target.ok) {
    return target;
  }
  const timing = input.recurrence
    ? timingColumns(deps, found, input.recurrence)
    : ok({});
  if (!timing.ok) {
    return timing;
  }
  // A new rule revives a completed schedule, which archiving didn't pause.
  if (
    input.recurrence &&
    found.completedAt &&
    !target &&
    found.conversationId &&
    (await isArchived(deps.db, actor, found.conversationId))
  ) {
    return err({ type: "target_archived" });
  }
  const row = await updateScheduleRow(deps.db, found.id, {
    ...timing.value,
    ...(target?.ok
      ? {
          conversationId: target.value.conversationId,
          dotId: target.value.dotId,
          targetKind: input.target?.kind,
        }
      : {}),
    ...editColumns(input),
  });
  return row ? ok(toSchedule(row)) : err({ type: "not_found" });
};

export const removeSchedule = async (
  db: Db,
  actor: Actor,
  id: DotScheduleId
): Promise<Result<void, ScheduleError>> => {
  const found = await getSchedule(db, id, actor.userId);
  if (!found) {
    return err({ type: "not_found" });
  }
  await deleteScheduleRow(db, id);
  return ok(undefined);
};

export const pauseSchedule = async (
  deps: Pick<ScheduleDeps, "db">,
  actor: Actor,
  id: DotScheduleId
): Promise<Result<Schedule, ScheduleError>> => {
  const found = await getSchedule(deps.db, id, actor.userId);
  if (!found) {
    return err({ type: "not_found" });
  }
  if (statusOf(found) !== "active") {
    return ok(toSchedule(found));
  }
  const row = await updateScheduleRow(deps.db, id, {
    enabled: false,
    nextRunAt: null,
    nextRunNominalAt: null,
    pausedReason: "user",
  });
  return row ? ok(toSchedule(row)) : err({ type: "not_found" });
};

/** Resumes from the first slot after now; missed slots aren't replayed. */
export const resumeSchedule = async (
  deps: Pick<ScheduleDeps, "db" | "now">,
  actor: Actor,
  id: DotScheduleId
): Promise<Result<Schedule, ScheduleError>> => {
  const found = await getSchedule(deps.db, id, actor.userId);
  if (!found) {
    return err({ type: "not_found" });
  }
  if (found.completedAt) {
    return err({ type: "completed" });
  }
  if (
    found.conversationId &&
    (await isArchived(deps.db, actor, found.conversationId))
  ) {
    return err({ type: "target_archived" });
  }
  const recurrence = recurrenceOf(found);
  const next = nextNominal(recurrence, deps.now());
  const nominal = next.ok ? next.value : null;
  if (!nominal) {
    return err({ type: "completed" });
  }
  const row = await updateScheduleRow(deps.db, id, {
    ...nextColumns(found.id, recurrence, nominal),
    enabled: true,
    pausedReason: null,
  });
  return row ? ok(toSchedule(row)) : err({ type: "not_found" });
};

/** The guardrails and today's usage, for the schedules page. */
export const scheduleLimitsFor = async (
  deps: Pick<ScheduleDeps, "db" | "defaultModel" | "limits" | "now">,
  ownerId: UserId
): Promise<ScheduleLimits> => ({
  defaultModel: deps.defaultModel ?? "",
  maxRunsPerDay: deps.limits.maxRunsPerUserPerDay,
  minIntervalMinutes: deps.limits.minIntervalMinutes,
  runStepBudget: deps.limits.runStepBudget,
  runsToday: await runsInLastDay(deps.db, ownerId, deps.now()),
  runTokenBudget: deps.limits.runTokenBudget,
});

export const listRunsFor = async (
  db: Db,
  ownerId: UserId,
  input: ScheduleRunsInput
): Promise<Result<ScheduleRun[], ScheduleError>> => {
  const found = await getSchedule(db, input.id, ownerId);
  if (!found) {
    return err({ type: "not_found" });
  }
  const rows = await listScheduleRuns(
    db,
    found.id,
    input.limit,
    input.before ? new Date(input.before) : undefined
  );
  return ok(rows.map(toScheduleRun));
};

export const markRunsRead = async (
  deps: Pick<ScheduleDeps, "db" | "now">,
  actor: Actor,
  id: DotScheduleId
): Promise<Result<void, ScheduleError>> => {
  const found = await getSchedule(deps.db, id, actor.userId);
  if (!found) {
    return err({ type: "not_found" });
  }
  await markScheduleRunsRead(deps.db, id, deps.now());
  return ok(undefined);
};

const dateLabel = (at: Date, timeZone: string): string => {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      timeZone,
    }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
};

/**
 * Records the started run on its claim, or gives back the claim of a run
 * that didn't start. The tick gives back a claim no run took within
 * `CLAIM_STALE_MS`; a run that starts after that has no place under the
 * cap, so it's cancelled.
 */
export const settleClaim = async <E>(
  deps: Pick<ScheduleDeps, "db" | "runs">,
  claim: Pick<ScheduleRunRow, "id" | "ownerId">,
  started: Result<CreateRunOutput, E>
): Promise<Result<CreateRunOutput, E | ScheduleError>> => {
  if (!started.ok) {
    await releaseClaim(deps.db, claim.id);
    return started;
  }
  const recorded = await updateScheduleRun(deps.db, claim.id, {
    conversationId: started.value.conversationId,
    runId: started.value.runId,
  });
  if (recorded) {
    return started;
  }
  await deps.runs.executor.cancel(started.value.runId, null);
  return err({ retryAfterSeconds: 3600, type: "cap" });
};

/**
 * Posts the schedule's prompt into its target as the owner, labelled with a
 * `scheduled-task` data part, and starts the run. `createUnattendedRun` re-checks that
 * the owner may still write there and use the agent, so a revoked share or
 * agent fails the run cleanly. A chat made for a run that didn't start is
 * deleted again.
 */
const postScheduleRun = async (
  deps: ScheduleDeps,
  schedule: ScheduleRow,
  claim: ScheduleRunRow
): Promise<Result<CreateRunOutput, ScheduleError>> => {
  const { db } = deps;
  const actor = await ownerActor(db, schedule.ownerId);
  const dot = schedule.dotId ? await getDotById(db, schedule.dotId) : null;
  let conversationId = dot?.conversationId ?? schedule.conversationId;
  let made: ConversationId | null = null;
  const target = runTargetOf(dot, deps.defaultModel);
  if (schedule.targetKind === "new_chat_each_run" || !conversationId) {
    const context = await storeContext(db, actor, { type: "personal" });
    if (!context.ok) {
      return err({ type: "no_personal_space" });
    }
    const chat = await createConversation(db, {
      context: context.value,
      defaultTarget: target,
      ownerId: schedule.ownerId,
      title: `${schedule.title || "Scheduled task"} · ${dateLabel(claim.nominalAt ?? deps.now(), schedule.timezone)}`,
    });
    made = chat.id;
    conversationId = chat.id;
  }
  const created = await createUnattendedRun(
    deps.runs,
    actor,
    {
      conversationId,
      idempotencyKey: dotRunKey(claim.id),
      input: {
        parentId: await latestMessageId(db, conversationId),
        parts: [
          {
            data: { scheduleId: schedule.id, title: schedule.title },
            name: SCHEDULED_TASK_DATA,
            type: "data",
          },
          { text: schedule.prompt, type: "text" },
        ],
        type: "message",
      },
      target,
    },
    { scheduleId: schedule.id, type: "schedule" }
  );
  const settled = await settleClaim(
    deps,
    claim,
    created.ok ? created : err({ error: created.error, type: "run" } as const)
  );
  // A retried claim finds its run in the chat the first attempt made.
  if (made && (!settled.ok || settled.value.conversationId !== made)) {
    await deleteConversation(db, made);
  }
  return settled;
};

export const startScheduleRun = async (
  deps: ScheduleDeps,
  schedule: ScheduleRow,
  claim: ScheduleRunRow
): Promise<Result<CreateRunOutput, ScheduleError>> => {
  const started = await postScheduleRun(deps, schedule, claim);
  await updateScheduleRow(
    deps.db,
    schedule.id,
    started.ok
      ? { lastRunAt: deps.now(), lastStatus: "queued" }
      : { lastOutcome: "failed", lastStatus: "failed" }
  );
  return started;
};

export const claimRunNow = async (
  deps: Pick<ScheduleDeps, "db" | "limits" | "now">,
  claim: Pick<
    NewScheduleRun,
    "conversationId" | "dotId" | "ownerId" | "scheduleId"
  >
): Promise<Result<ScheduleRunRow, ScheduleError>> => {
  const row = await claimRun(
    deps.db,
    { ...claim, notified: false, trigger: "manual" },
    deps.now(),
    deps.limits.maxRunsPerUserPerDay
  );
  return row ? ok(row) : err({ retryAfterSeconds: 3600, type: "cap" });
};

/**
 * "Run now": the saved prompt once, unattended. Counts toward the daily
 * cap; a target already answering something is `busy`, and an archived
 * one is refused as resume refuses it.
 */
export const runScheduleNow = async (
  deps: ScheduleDeps,
  actor: Actor,
  id: DotScheduleId
): Promise<Result<CreateRunOutput, ScheduleError>> => {
  const found = await getSchedule(deps.db, id, actor.userId);
  if (!found) {
    return err({ type: "not_found" });
  }
  const target = found.dotId
    ? (await getDotById(deps.db, found.dotId))?.conversationId
    : found.conversationId;
  if (found.targetKind !== "new_chat_each_run" && target) {
    if (await isArchived(deps.db, actor, target)) {
      return err({ type: "target_archived" });
    }
    if (await conversationBusy(deps.db, target)) {
      return err({ type: "busy" });
    }
  }
  const claim = await claimRunNow(deps, {
    conversationId: found.conversationId,
    dotId: found.dotId,
    ownerId: found.ownerId,
    scheduleId: found.id,
  });
  return claim.ok ? startScheduleRun(deps, found, claim.value) : claim;
};

/** What a fired slot did: a run, or why it didn't start one. */
export type FireOutcome =
  | { readonly runId: string; readonly type: "started" }
  | {
      readonly reason: "disabled" | "gone" | "run_failed";
      readonly type: "skipped";
    };

/**
 * Starts one claimed slot (the `dot.run` job). Gives the claim back when
 * the schedule was removed or paused since the tick claimed it.
 */
export const fireSchedule = async (
  deps: ScheduleDeps,
  claimId: DotRunId
): Promise<FireOutcome> => {
  const claim = await getScheduleRunById(deps.db, claimId);
  if (claim?.runId) {
    return { runId: claim.runId, type: "started" };
  }
  const schedule = claim?.scheduleId
    ? await getScheduleById(deps.db, claim.scheduleId)
    : null;
  if (!(claim && schedule)) {
    if (claim) {
      await releaseClaim(deps.db, claim.id);
    }
    return { reason: "gone", type: "skipped" };
  }
  // The claim already moved it on (and may have completed a one-off), so
  // only a pause since then stops it.
  const dot = schedule.dotId ? await getDotById(deps.db, schedule.dotId) : null;
  if (
    (!schedule.enabled && schedule.completedAt === null) ||
    (schedule.dotId && !dot?.enabled)
  ) {
    await releaseClaim(deps.db, claim.id);
    return { reason: "disabled", type: "skipped" };
  }
  const started = await startScheduleRun(deps, schedule, claim);
  return started.ok
    ? { runId: started.value.runId, type: "started" }
    : { reason: "run_failed", type: "skipped" };
};

/** The tick: claims due schedules under the policy and returns the claims to start. */
export const claimDue = async (
  deps: Pick<ScheduleDeps, "db" | "limits">,
  now: Date
): Promise<readonly DotRunId[]> => {
  await releaseStaleClaims(deps.db, new Date(now.getTime() - CLAIM_STALE_MS));
  const claims = await claimDueSchedules(deps.db, now, (row, context) =>
    planDue(row, now, context, deps.limits)
  );
  return claims.map((claim) => claim.id);
};

/**
 * After any run settles: if a schedule (or a Dot's "Run now") started it,
 * record what it concluded and whether that told the owner, and pause the
 * schedule after repeated failures.
 */
export const settleScheduleRun = async (
  db: Db,
  runId: Parameters<typeof scheduleRunFor>[1],
  status: RunStatus
): Promise<void> => {
  const found = await scheduleRunFor(db, runId);
  if (!found) {
    return;
  }
  const row = await getRun(db, runId);
  const reply =
    row.ok && row.value.assistantMessageId
      ? await getMessage(db, row.value.assistantMessageId)
      : null;
  const conclusion = concludeRun(status, reply?.ok ? reply.value.parts : null);
  const notified = found.schedule
    ? shouldNotify(conclusion.outcome, found.schedule.notify)
    : conclusion.outcome !== "no_update";
  await updateScheduleRun(db, found.run.id, {
    notified,
    outcome: conclusion.outcome,
    summary: conclusion.summary,
  });
  if (!found.schedule) {
    return;
  }
  await updateScheduleRow(db, found.schedule.id, {
    lastOutcome: conclusion.outcome,
    lastStatus: status,
  });
  if (status !== "failed") {
    return;
  }
  const recent = await recentScheduleStatuses(
    db,
    found.schedule.id,
    AUTO_PAUSE_AFTER_FAILURES
  );
  if (shouldAutoPause(recent)) {
    await updateScheduleRow(db, found.schedule.id, {
      enabled: false,
      nextRunAt: null,
      nextRunNominalAt: null,
      pausedReason: "failures",
    });
  }
};
