import {
  isOnce,
  jitteredAt,
  missedSlotsBetween,
  nextNominal,
  ONCE_MAX_DAYS,
  type RecurrenceError,
  tooFrequent,
} from "@workspace/ai/schedules/recurrence";
import { REPORT_TOOL, reportInputSchema } from "@workspace/ai/schedules/tool";
import type { MessagePart } from "@workspace/contract/schemas/message-parts";
import type { RunStatus } from "@workspace/contract/schemas/runs";
import type {
  ConversationSchedule,
  Schedule,
  ScheduleNotify,
  ScheduleRecurrence,
  ScheduleRunOutcome,
  ScheduleTarget,
} from "@workspace/contract/schemas/schedules";
import type {
  DueContext,
  DueDecision,
  ScheduleRow,
} from "@workspace/db/queries/dots";
import { err, type Result } from "@workspace/shared/result";
import { snippetOf } from "./policy";

// Schedules' functional core (173, 175): what a stored row means, what the
// tick does with a due one, what a finished run concluded, and whether that
// tells the owner. No I/O here.

/** The guardrails from app.config.yaml `schedules` (175). */
export interface ScheduleLimitsConfig {
  readonly maxRunsPerUserPerDay: number;
  readonly minIntervalMinutes: number;
  readonly runStepBudget: number;
  readonly runTokenBudget: number;
}

export const DEFAULT_SCHEDULE_LIMITS: ScheduleLimitsConfig = {
  maxRunsPerUserPerDay: 24,
  minIntervalMinutes: 60,
  runStepBudget: 8,
  runTokenBudget: 20_000,
};

const iso = (date: Date | null): string | null =>
  date ? date.toISOString() : null;

/** The stored recurrence as the contract's union. */
export const recurrenceOf = (row: ScheduleRow): ScheduleRecurrence =>
  row.rrule && row.startAt
    ? {
        endsAt: iso(row.endsAt),
        kind: "rrule",
        rrule: row.rrule,
        startAt: row.startAt.toISOString(),
        timezone: row.timezone,
      }
    : {
        cron: row.cron ?? "0 9 * * *",
        endsAt: iso(row.endsAt),
        kind: "cron",
        timezone: row.timezone,
      };

/** The columns a recurrence is stored in. */
export const recurrenceColumns = (recurrence: ScheduleRecurrence) =>
  recurrence.kind === "rrule"
    ? {
        cron: null,
        endsAt: recurrence.endsAt ? new Date(recurrence.endsAt) : null,
        rrule: recurrence.rrule,
        startAt: new Date(recurrence.startAt),
        timezone: recurrence.timezone,
      }
    : {
        cron: recurrence.cron,
        endsAt: recurrence.endsAt ? new Date(recurrence.endsAt) : null,
        rrule: null,
        startAt: null,
        timezone: recurrence.timezone,
      };

export const targetOf = (row: ScheduleRow): ScheduleTarget => {
  switch (row.targetKind) {
    case "conversation":
      return row.conversationId
        ? { conversationId: row.conversationId, kind: "conversation" }
        : { kind: "new_chat_each_run" };
    case "new_chat_each_run":
      return { kind: "new_chat_each_run" };
    default:
      return { kind: "dot" };
  }
};

export const statusOf = (row: ScheduleRow): Schedule["status"] => {
  if (row.completedAt) {
    return "completed";
  }
  return row.enabled ? "active" : "paused";
};

/** The contract's `Schedule` from its row. Pure. */
export const toSchedule = (row: ScheduleRow): Schedule => {
  const status = statusOf(row);
  return {
    autoApproveTools: row.autoApproveTools,
    conversationId: row.conversationId,
    createdAt: row.createdAt.toISOString(),
    dotId: row.dotId,
    id: row.id,
    lastOutcome: row.lastOutcome ?? null,
    lastRunAt: iso(row.lastRunAt),
    missedRunPolicy: row.missedRunPolicy,
    nextRunAt: status === "active" ? iso(row.nextRunAt) : null,
    nextRunNominalAt:
      status === "active" ? iso(row.nextRunNominalAt ?? row.nextRunAt) : null,
    notify: row.notify,
    ownerId: row.ownerId,
    pausedReason: status === "paused" ? (row.pausedReason ?? "user") : null,
    prompt: row.prompt,
    readOnly: row.readOnly,
    recurrence: recurrenceOf(row),
    status,
    target: targetOf(row),
    title: row.title.trim() === "" ? row.prompt.slice(0, 60) : row.title,
    updatedAt: row.updatedAt.toISOString(),
  };
};

/** A schedule as the summary on its conversation (sidebar row, header). */
export const toConversationSchedule = (
  row: ScheduleRow
): ConversationSchedule => {
  const schedule = toSchedule(row);
  return {
    id: schedule.id,
    nextRunNominalAt: schedule.nextRunNominalAt,
    status: schedule.status,
    title: schedule.title,
  };
};

export type RecurrenceCheckError =
  | (RecurrenceError & { readonly path: readonly (string | number)[] })
  | {
      readonly message: string;
      readonly path: readonly (string | number)[];
      readonly type: "too_frequent" | "once_out_of_range";
    };

/**
 * A recurrence's first slot, after the guardrails: no more often than the
 * minimum interval, a one-off in the future and within two years.
 */
export const checkRecurrence = (
  recurrence: ScheduleRecurrence,
  now: Date,
  limits: Pick<ScheduleLimitsConfig, "minIntervalMinutes">
): Result<Date | null, RecurrenceCheckError> => {
  const path = ["recurrence"];
  const first = nextNominal(recurrence, now);
  if (!first.ok) {
    return err({ ...first.error, path });
  }
  if (isOnce(recurrence)) {
    const at = new Date(
      recurrence.kind === "rrule" ? recurrence.startAt : now
    ).getTime();
    if (at <= now.getTime()) {
      return err({
        message: "Pick a time in the future.",
        path: [...path, "startAt"],
        type: "once_out_of_range",
      });
    }
    if (at - now.getTime() > ONCE_MAX_DAYS * 86_400_000) {
      return err({
        message: "Pick a time within two years.",
        path: [...path, "startAt"],
        type: "once_out_of_range",
      });
    }
    return first;
  }
  const frequent = tooFrequent(recurrence, now, limits.minIntervalMinutes);
  if (!frequent.ok) {
    return err({ ...frequent.error, path });
  }
  if (frequent.value) {
    const minutes = limits.minIntervalMinutes;
    return err({
      message: `This instance allows runs every ${minutes} minutes or longer.`,
      path,
      type: "too_frequent",
    });
  }
  return first;
};

/** The stored next-run columns for a nominal slot (or none: completed). */
export const nextColumns = (
  id: string,
  recurrence: ScheduleRecurrence,
  nominal: Date | null
) =>
  nominal
    ? {
        nextRunAt: jitteredAt(id, recurrence, nominal),
        nextRunNominalAt: nominal,
      }
    : { nextRunAt: null, nextRunNominalAt: null };

/** How long a busy target waits before the tick tries it again. */
export const BUSY_RETRY_MS = 60_000;

/** With `missedRunPolicy: "skip"`, a slot later than this after downtime is skipped. */
export const LATE_GRACE_MS = 15 * 60_000;

/**
 * What the tick does with one due schedule. Overdue slots always collapse
 * into one; the next slot is the first after now. A busy target defers by a
 * minute until the next slot would arrive, then that slot is skipped
 * (`busy`). The daily cap skips (`cap`), and a one-off or ended rule
 * completes after firing.
 */
export const planDue = (
  row: ScheduleRow,
  now: Date,
  context: DueContext,
  limits: Pick<ScheduleLimitsConfig, "maxRunsPerUserPerDay">
): DueDecision => {
  const recurrence = recurrenceOf(row);
  const nominal = row.nextRunNominalAt ?? row.nextRunAt ?? now;
  const later = now.getTime() > nominal.getTime() ? now : nominal;
  const followed = nextNominal(recurrence, later);
  const following = followed.ok ? followed.value : null;
  const missedSlots = missedSlotsBetween(recurrence, nominal, now);
  const advance = {
    ...nextColumns(row.id, recurrence, following),
    completedAt: following ? null : now,
    lastRunAt: now,
  };
  const skip = (
    reason: NonNullable<DueDecision["skip"]>["skipReason"]
  ): DueDecision => ({
    fire: null,
    patch: { ...advance, lastOutcome: "skipped" },
    skip: {
      conversationId: row.conversationId,
      dotId: row.dotId,
      missedSlots,
      nominalAt: nominal,
      notified: false,
      outcome: "skipped",
      skipReason: reason,
      trigger: "schedule",
    },
  });
  if (row.targetKind === "conversation" && !row.conversationId) {
    return {
      fire: null,
      patch: {
        enabled: false,
        nextRunAt: null,
        nextRunNominalAt: null,
        pausedReason: "target_archived",
      },
      skip: null,
    };
  }
  if (context.runsToday >= limits.maxRunsPerUserPerDay) {
    return skip("cap");
  }
  if (
    row.missedRunPolicy === "skip" &&
    now.getTime() - nominal.getTime() > LATE_GRACE_MS
  ) {
    return skip("missed");
  }
  if (context.busy) {
    const retryAt = new Date(now.getTime() + BUSY_RETRY_MS);
    if (following === null || retryAt.getTime() < following.getTime()) {
      // Stay due on the same slot; try again next minute.
      return { fire: null, patch: { nextRunAt: retryAt }, skip: null };
    }
    return skip("busy");
  }
  return { fire: { missedSlots, nominal }, patch: advance, skip: null };
};

/**
 * Whether a run's outcome tells the owner. Quiet runs (`no_update`) and
 * skipped slots never do; a failure does under every policy but `none`.
 */
export const shouldNotify = (
  outcome: ScheduleRunOutcome,
  policy: ScheduleNotify
): boolean => {
  if (policy === "none" || outcome === "no_update" || outcome === "skipped") {
    return false;
  }
  if (outcome === "failed") {
    return true;
  }
  switch (policy) {
    case "failures":
      return false;
    case "important":
      return outcome === "needs_attention";
    case "all":
      return true;
    default:
      return policy satisfies never;
  }
};

/** What a finished run said about itself, and its one-line summary. */
export interface RunConclusion {
  readonly outcome: ScheduleRunOutcome;
  readonly summary: string | null;
}

const SILENT = /^\s*(?:<decision>\s*)?DONT_NOTIFY(?:\s*<\/decision>)?\s*$/;

/**
 * The outcome of a scheduled run from its reply. The run's `report` call
 * wins; without one, a reply of only `DONT_NOTIFY` (ChatGPT's heartbeat
 * convention) or no text at all is `no_update`, and any other text is
 * `update`. A failed run is `failed`, whatever it said.
 */
export const concludeRun = (
  status: RunStatus,
  parts: readonly MessagePart[] | null
): RunConclusion => {
  const snippet = snippetOf(parts);
  if (status === "failed") {
    return { outcome: "failed", summary: snippet };
  }
  for (const part of [...(parts ?? [])].reverse()) {
    if (part.type === "tool-call" && part.toolName === REPORT_TOOL) {
      const report = reportInputSchema.safeParse(part.input);
      if (report.success) {
        return {
          outcome: report.data.outcome,
          summary: report.data.summary?.trim() || snippet,
        };
      }
    }
  }
  if (snippet === null || SILENT.test(snippet)) {
    return { outcome: "no_update", summary: null };
  }
  return { outcome: "update", summary: snippet };
};
