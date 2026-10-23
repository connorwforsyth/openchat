import { z } from "zod";

import {
  conversationIdSchema,
  dotIdSchema,
  dotRunIdSchema,
  dotScheduleIdSchema,
  runIdSchema,
  timestampSchema,
  userIdSchema,
} from "./common";
import { toolNameSchema } from "./message-parts";
import { runStatusSchema } from "./runs";

// Schedules (173a): their own objects, separate from the Dot. A schedule
// posts its prompt into a target on a recurrence and answers it unattended:
// the owner's Dot thread, any chat the owner can write (a "heartbeat"), or
// a new chat each run. Each firing is a `ScheduleRun` with an outcome the
// run reports itself, which decides whether the owner is told (`notify`).

/** An IANA time zone (`Europe/London`); the server rejects unknown ones. */
export const scheduleTimeZoneSchema = z.string().trim().min(1).max(64);

/**
 * When a schedule fires.
 *
 * - `rrule`: an RFC 5545 RRULE body without `DTSTART` (`FREQ=DAILY;BYHOUR=8;BYMINUTE=0`),
 *   expanded in `timezone` from `startAt`. Supported parts: `FREQ` (MINUTELY
 *   to YEARLY), `INTERVAL`, `BYDAY` (no ordinals), `BYMONTHDAY`, `BYMONTH`,
 *   `BYHOUR`, `BYMINUTE` and `COUNT=1` (a one-off at `startAt`, at most two
 *   years out). Anything else is a `VALIDATION` error. Wall-clock rules keep their
 *   local time across DST; MINUTELY and HOURLY count elapsed time.
 * - `cron`: five fields, for schedules made before RRULE and the raw editor.
 *
 * `endsAt` stops either kind ("End repeat").
 */
export const scheduleRecurrenceSchema = z.discriminatedUnion("kind", [
  z.object({
    endsAt: timestampSchema.nullable().default(null),
    kind: z.literal("rrule"),
    rrule: z.string().trim().min(6).max(500),
    startAt: timestampSchema,
    timezone: scheduleTimeZoneSchema,
  }),
  z.object({
    cron: z.string().trim().min(9).max(120),
    endsAt: timestampSchema.nullable().default(null),
    kind: z.literal("cron"),
    timezone: scheduleTimeZoneSchema,
  }),
]);
export type ScheduleRecurrence = z.infer<typeof scheduleRecurrenceSchema>;

/**
 * Where a run posts. `dot`: the owner's Dot thread (with the Dot's persona
 * and model). `conversation`: a chat the owner can write, labelled "Sent by
 * scheduled task". `new_chat_each_run`: a fresh chat titled
 * `<title> · <date>` every time.
 */
export const scheduleTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("dot") }),
  z.object({
    conversationId: conversationIdSchema,
    kind: z.literal("conversation"),
  }),
  z.object({ kind: z.literal("new_chat_each_run") }),
]);
export type ScheduleTarget = z.infer<typeof scheduleTargetSchema>;

/**
 * When the owner is told about a run (in-app unread now; push later).
 * `all`: every run that has something to say (not `no_update`). `failures`:
 * only runs that failed. `important`: only `needs_attention` and failures.
 * `none`: never.
 */
export const scheduleNotifySchema = z.enum([
  "all",
  "failures",
  "important",
  "none",
]);
export type ScheduleNotify = z.infer<typeof scheduleNotifySchema>;

/** `completed`: a one-off that fired, or a rule past its `endsAt`. */
export const scheduleStatusSchema = z.enum(["active", "paused", "completed"]);
export type ScheduleStatus = z.infer<typeof scheduleStatusSchema>;

/**
 * Why a schedule is paused, so the UI can say so: the owner paused it, it
 * failed three times in a row, or its target chat was archived or deleted.
 */
export const schedulePausedReasonSchema = z.enum([
  "user",
  "failures",
  "target_archived",
]);
export type SchedulePausedReason = z.infer<typeof schedulePausedReasonSchema>;

/**
 * What a run concluded, reported by the run itself (a `report` tool call):
 * something to say, nothing new (silent: no unread, no notification), or
 * the owner should look. `failed` and `skipped` are set by the server.
 */
export const scheduleRunOutcomeSchema = z.enum([
  "update",
  "no_update",
  "needs_attention",
  "failed",
  "skipped",
]);
export type ScheduleRunOutcome = z.infer<typeof scheduleRunOutcomeSchema>;

/**
 * Why a slot didn't run: the owner's daily run cap, a spent budget, the
 * target archived, the target busy until the next slot, or `missed` (the
 * `skip` missed-run policy after downtime).
 */
export const scheduleSkipReasonSchema = z.enum([
  "cap",
  "budget",
  "target_archived",
  "busy",
  "missed",
]);
export type ScheduleSkipReason = z.infer<typeof scheduleSkipReasonSchema>;

/**
 * After downtime, overdue slots always collapse into one. `run_once` fires
 * that one late; `skip` records it skipped and waits for the next slot.
 */
export const scheduleMissedRunPolicySchema = z.enum(["run_once", "skip"]);
export type ScheduleMissedRunPolicy = z.infer<
  typeof scheduleMissedRunPolicySchema
>;

/** A task's name: shown in lists, on the posted message and in new chat titles. */
export const scheduleTitleSchema = z.string().trim().min(1).max(80);

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const startsPictographic = /^\p{Extended_Pictographic}/u;
const flagEmoji = /^\p{Regional_Indicator}{2}$/u;
const keycapEmoji = /^[0-9#*]\uFE0F?\u20E3$/u;

/** A task's label: one emoji, shown beside its title wherever it's listed. */
export const scheduleEmojiSchema = z
  .string()
  .trim()
  .max(32)
  .refine(
    (value) =>
      (startsPictographic.test(value) ||
        flagEmoji.test(value) ||
        keycapEmoji.test(value)) &&
      [...graphemes.segment(value)].length === 1,
    "Must be a single emoji"
  )
  .describe(
    "One emoji grapheme, including flag pairs, keycaps and joined sequences."
  );

/** The label a schedule gets when none is picked. */
export const DEFAULT_SCHEDULE_EMOJI = "⏰";

/** The prompt each run posts. Capped: it's resent every run. */
export const schedulePromptSchema = z.string().trim().min(1).max(4000);

export const scheduleSchema = z.object({
  /** Tools it may run unattended even where they'd ask. */
  autoApproveTools: z.array(toolNameSchema).max(100),
  /** The chat runs post into; `null` for `new_chat_each_run` (and a deleted target). */
  conversationId: conversationIdSchema.nullable(),
  createdAt: timestampSchema,
  /** The Dot whose thread it targets, for `target.kind === "dot"`. */
  dotId: dotIdSchema.nullable(),
  emoji: scheduleEmojiSchema.optional(),
  id: dotScheduleIdSchema,
  lastOutcome: scheduleRunOutcomeSchema.nullable(),
  lastRunAt: timestampSchema.nullable(),
  missedRunPolicy: scheduleMissedRunPolicySchema,
  /** When it actually fires: `nextRunNominalAt` plus a small deterministic jitter. */
  nextRunAt: timestampSchema.nullable(),
  /** The time the rule says; show this one. `null` unless active. */
  nextRunNominalAt: timestampSchema.nullable(),
  notify: scheduleNotifySchema,
  ownerId: userIdSchema,
  pausedReason: schedulePausedReasonSchema.nullable(),
  prompt: schedulePromptSchema,
  /**
   * Withhold tools that write (files, sandbox edits, publishing). The
   * default for heartbeats on an ordinary chat; a Dot's own schedules can write.
   */
  readOnly: z.boolean(),
  recurrence: scheduleRecurrenceSchema,
  status: scheduleStatusSchema,
  target: scheduleTargetSchema,
  title: scheduleTitleSchema,
  updatedAt: timestampSchema,
});
export type Schedule = z.infer<typeof scheduleSchema>;

export const scheduleRunTriggerSchema = z.enum(["scheduled", "run_now"]);
export type ScheduleRunTrigger = z.infer<typeof scheduleRunTriggerSchema>;

const scheduleRunFields = {
  conversationId: conversationIdSchema.nullable(),
  createdAt: timestampSchema,
  id: dotRunIdSchema,
  /** Overdue slots folded into this one after downtime. */
  missedSlots: z.number().int().min(0),
  /** The slot the rule named; `null` for "Run now". */
  nominalAt: timestampSchema.nullable(),
  /** Whether it told the owner (the notify policy applied to the outcome). */
  notified: z.boolean(),
  readAt: timestampSchema.nullable(),
  scheduleId: dotScheduleIdSchema.nullable(),
  trigger: scheduleRunTriggerSchema,
};

/**
 * One firing, keyed on `outcome`: a run that started (its outcome is `null`
 * while it's going), or a slot that was `skipped` and why.
 */
export const scheduleRunSchema = z.discriminatedUnion("outcome", [
  z.object({
    ...scheduleRunFields,
    error: z.string().max(2000).nullable(),
    finishedAt: timestampSchema.nullable(),
    outcome: scheduleRunOutcomeSchema.exclude(["skipped"]).nullable(),
    runId: runIdSchema,
    status: runStatusSchema,
    /** The run's one-line summary, or the start of its reply. */
    summary: z.string().max(500).nullable(),
  }),
  z.object({
    ...scheduleRunFields,
    outcome: z.literal("skipped"),
    skipReason: scheduleSkipReasonSchema,
  }),
]);
export type ScheduleRun = z.infer<typeof scheduleRunSchema>;

/** The guardrails that apply to the caller, and how much of today's cap is used. */
export const scheduleLimitsSchema = z.object({
  /** The model a schedule on an ordinary chat answers with. */
  defaultModel: z.string(),
  maxRunsPerDay: z.number().int().min(1),
  minIntervalMinutes: z.number().int().min(1),
  runStepBudget: z.number().int().min(1),
  /** Runs started in the last 24 hours (the cap is rolling). */
  runsToday: z.number().int().min(0),
  runTokenBudget: z.number().int().min(1),
});
export type ScheduleLimits = z.infer<typeof scheduleLimitsSchema>;

export const createScheduleInputSchema = z.object({
  autoApproveTools: z.array(toolNameSchema).max(100).default([]),
  emoji: scheduleEmojiSchema.default(DEFAULT_SCHEDULE_EMOJI).optional(),
  missedRunPolicy: scheduleMissedRunPolicySchema.default("run_once"),
  notify: scheduleNotifySchema.default("important"),
  /** Start paused. */
  paused: z.boolean().default(false),
  prompt: schedulePromptSchema,
  /** Omitted: read-only unless it targets the Dot. */
  readOnly: z.boolean().optional(),
  recurrence: scheduleRecurrenceSchema,
  target: scheduleTargetSchema,
  title: scheduleTitleSchema,
});
export type CreateScheduleInput = z.infer<typeof createScheduleInputSchema>;

export const updateScheduleInputSchema = z.object({
  autoApproveTools: z.array(toolNameSchema).max(100).optional(),
  emoji: scheduleEmojiSchema.optional(),
  id: dotScheduleIdSchema,
  missedRunPolicy: scheduleMissedRunPolicySchema.optional(),
  notify: scheduleNotifySchema.optional(),
  prompt: schedulePromptSchema.optional(),
  readOnly: z.boolean().optional(),
  recurrence: scheduleRecurrenceSchema.optional(),
  target: scheduleTargetSchema.optional(),
  title: scheduleTitleSchema.optional(),
});
export type UpdateScheduleInput = z.infer<typeof updateScheduleInputSchema>;

export const listSchedulesInputSchema = z.object({
  /** Only schedules posting into this chat. */
  conversationId: conversationIdSchema.optional(),
  status: scheduleStatusSchema.optional(),
});
export type ListSchedulesInput = z.infer<typeof listSchedulesInputSchema>;

export const scheduleRunsInputSchema = z.object({
  /** Older than this (a `createdAt` from the previous page): "Show older". */
  before: timestampSchema.optional(),
  id: dotScheduleIdSchema,
  limit: z.number().int().min(1).max(100).default(20),
});
export type ScheduleRunsInput = z.infer<typeof scheduleRunsInputSchema>;

export const runScheduleNowInputSchema = z.object({ id: dotScheduleIdSchema });

/** On a conversation: the schedule posting into it, for the sidebar row and header. */
export const conversationScheduleSchema = z.object({
  emoji: scheduleEmojiSchema.optional(),
  id: dotScheduleIdSchema,
  nextRunNominalAt: timestampSchema.nullable(),
  status: scheduleStatusSchema,
  title: scheduleTitleSchema,
});
export type ConversationSchedule = z.infer<typeof conversationScheduleSchema>;
