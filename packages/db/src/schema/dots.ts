import {
  type DotAvatarColor,
  type DotAvatarStyle,
  dotAvatarColorSchema,
  dotAvatarStyleSchema,
  dotRunTriggerSchema,
} from "@workspace/contract/schemas/dots";
import {
  type RunTarget,
  runStatusSchema,
} from "@workspace/contract/schemas/runs";
import type { SandboxProvider } from "@workspace/contract/schemas/sandbox";
import {
  type ScheduleMissedRunPolicy,
  type ScheduleNotify,
  type SchedulePausedReason,
  type ScheduleRunOutcome,
  type ScheduleSkipReason,
  type ScheduleTarget,
  scheduleMissedRunPolicySchema,
  scheduleNotifySchema,
  scheduleRunOutcomeSchema,
  scheduleSkipReasonSchema,
} from "@workspace/contract/schemas/schedules";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { conversation, run } from "./chat";
import {
  createdAt,
  idColumn,
  idRef,
  instant,
  oneOf,
  updatedAt,
} from "./columns";

// Dots (172, 174): one always-on agent per user, which is a thread (its
// conversation). Schedules (173) are separate and can target that thread
// or any other chat. Which schedule is
// due is decided here (`next_run_at`), not by pg-boss: a once-a-minute tick
// claims due rows, so any number of schedules share one queue.

const scheduleTargetKinds: readonly ScheduleTarget["kind"][] = [
  "dot",
  "conversation",
  "new_chat_each_run",
];

export const dot = pgTable(
  "dot",
  {
    /** Tools it may run unattended even where its agent says `ask`. */
    autoApproveTools: jsonb("auto_approve_tools")
      .$type<string[]>()
      .notNull()
      .default([]),
    avatarColor: text("avatar_color")
      .$type<DotAvatarColor>()
      .notNull()
      .default("sea"),
    avatarStyle: text("avatar_style")
      .$type<DotAvatarStyle>()
      .notNull()
      .default("orb"),
    conversationId: idRef("conversation_id", "conversation")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    enabled: boolean("enabled").notNull().default(true),
    /** `@handle`, without the `@`; unique per owner. */
    handle: text("handle").notNull(),
    id: idColumn("dot"),
    instructions: text("instructions").notNull().default(""),
    /** When the owner last opened it; a run finished later is unread. */
    lastViewedAt: instant("last_viewed_at"),
    name: text("name").notNull(),
    ownerId: idRef("owner_id", "user")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** The owner's one primary Dot (a partial unique index keeps it one). */
    primary: boolean("is_primary").notNull().default(false),
    /** When it may act and when it should ask, in the owner's words. */
    rules: text("rules").notNull().default(""),
    /** `null` means the instance default. */
    sandboxProvider: text("sandbox_provider").$type<SandboxProvider>(),
    target: jsonb("target").$type<RunTarget>().notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("dot_owner_idx").on(t.ownerId, t.createdAt),
    uniqueIndex("dot_conversation_uidx").on(t.conversationId),
    uniqueIndex("dot_owner_handle_uidx").on(t.ownerId, t.handle),
    // One Dot per user (174).
    uniqueIndex("dot_owner_uidx").on(t.ownerId),
    uniqueIndex("dot_owner_primary_uidx")
      .on(t.ownerId)
      .where(sql`${t.primary}`),
    check(
      "dot_avatar_color",
      oneOf(t.avatarColor, dotAvatarColorSchema.options)
    ),
    check(
      "dot_avatar_style",
      oneOf(t.avatarStyle, dotAvatarStyleSchema.options)
    ),
  ]
);

/**
 * A scheduled task (173). Separate from the Dot: it targets the owner's Dot
 * thread (`dot_id`), any chat the owner can write (`conversation_id`), or a
 * new chat each run. The table keeps its 172 name; the code calls it a
 * schedule. `enabled` false is paused (`paused_reason` says why), and
 * `completed_at` marks a one-off that fired or a rule past its end.
 */
export const dotSchedule = pgTable(
  "dot_schedule",
  {
    autoApproveTools: jsonb("auto_approve_tools")
      .$type<string[]>()
      .notNull()
      .default([]),
    completedAt: instant("completed_at"),
    /**
     * The thread runs post into; `null` for a new chat each run. Deleting
     * the chat deletes its schedules; archiving it pauses them.
     */
    conversationId: idRef("conversation_id", "conversation").references(
      () => conversation.id,
      { onDelete: "cascade" }
    ),
    createdAt: createdAt(),
    /** Legacy five-field recurrence (172 and the raw editor); `rrule` otherwise. */
    cron: text("cron"),
    /** Set when the target is the owner's Dot. */
    dotId: idRef("dot_id", "dot").references(() => dot.id, {
      onDelete: "cascade",
    }),
    enabled: boolean("enabled").notNull().default(true),
    endsAt: instant("ends_at"),
    id: idColumn("dotSchedule"),
    lastOutcome: text("last_outcome").$type<ScheduleRunOutcome>(),
    lastRunAt: instant("last_run_at"),
    lastStatus:
      text("last_status").$type<(typeof runStatusSchema.options)[number]>(),
    missedRunPolicy: text("missed_run_policy")
      .$type<ScheduleMissedRunPolicy>()
      .notNull()
      .default("run_once"),
    /** When it fires (nominal plus jitter); `null` unless active. The tick fires rows at or before now. */
    nextRunAt: instant("next_run_at"),
    /** The slot the rule names, for display and for computing the next one. */
    nextRunNominalAt: instant("next_run_nominal_at"),
    notify: text("notify")
      .$type<ScheduleNotify>()
      .notNull()
      .default("important"),
    ownerId: idRef("owner_id", "user")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    pausedReason: text("paused_reason").$type<SchedulePausedReason>(),
    prompt: text("prompt").notNull(),
    readOnly: boolean("read_only").notNull().default(false),
    rrule: text("rrule"),
    /** The RRULE's DTSTART: the anchor for intervals, the moment of a one-off. */
    startAt: instant("start_at"),
    targetKind: text("target_kind")
      .$type<ScheduleTarget["kind"]>()
      .notNull()
      .default("dot"),
    timezone: text("timezone").notNull().default("UTC"),
    title: text("title").notNull().default(""),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("dot_schedule_dot_idx").on(t.dotId),
    index("dot_schedule_owner_idx").on(t.ownerId, t.createdAt),
    index("dot_schedule_conversation_idx").on(t.conversationId),
    index("dot_schedule_due_idx")
      .on(t.nextRunAt)
      .where(sql`${t.enabled} and ${t.nextRunAt} is not null`),
    check(
      "dot_schedule_last_status",
      sql`${t.lastStatus} is null or ${oneOf(t.lastStatus, runStatusSchema.options)}`
    ),
    check("dot_schedule_target_kind", oneOf(t.targetKind, scheduleTargetKinds)),
    check("dot_schedule_notify", oneOf(t.notify, scheduleNotifySchema.options)),
    check(
      "dot_schedule_missed_run_policy",
      oneOf(t.missedRunPolicy, scheduleMissedRunPolicySchema.options)
    ),
    check(
      "dot_schedule_recurrence",
      sql`${t.cron} is not null or (${t.rrule} is not null and ${t.startAt} is not null)`
    ),
  ]
);

/**
 * One firing of a schedule (or a Dot's "Run now"): the run it started, or
 * the slot it skipped and why, with the outcome the run reported and
 * whether that told the owner. The run row holds the rest.
 */
export const dotRun = pgTable(
  "dot_run",
  {
    conversationId: idRef("conversation_id", "conversation").references(
      () => conversation.id,
      { onDelete: "set null" }
    ),
    createdAt: createdAt(),
    dotId: idRef("dot_id", "dot").references(() => dot.id, {
      onDelete: "cascade",
    }),
    id: idColumn("dotRun"),
    missedSlots: integer("missed_slots").notNull().default(0),
    /** The slot the rule named; `null` for "Run now". */
    nominalAt: instant("nominal_at"),
    /** Whether the notify policy told the owner; only these count as unread. */
    notified: boolean("notified").notNull().default(true),
    /** `null` while the run is claimed or going. */
    outcome: text("outcome").$type<ScheduleRunOutcome>(),
    ownerId: idRef("owner_id", "user")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    readAt: instant("read_at"),
    /** `null` for a skipped slot. */
    runId: idRef("run_id", "run").references(() => run.id, {
      onDelete: "cascade",
    }),
    scheduleId: idRef("schedule_id", "dotSchedule").references(
      () => dotSchedule.id,
      { onDelete: "set null" }
    ),
    skipReason: text("skip_reason").$type<ScheduleSkipReason>(),
    /**
     * When a start last took this claim. The tick's sweep counts a claim's
     * age from here, so it can't give back a claim whose run is starting.
     */
    startingAt: instant("starting_at"),
    summary: text("summary"),
    trigger: text("trigger")
      .$type<(typeof dotRunTriggerSchema.options)[number]>()
      .notNull(),
  },
  (t) => [
    index("dot_run_dot_idx").on(t.dotId, t.createdAt),
    index("dot_run_schedule_idx").on(t.scheduleId, t.createdAt),
    index("dot_run_owner_idx").on(t.ownerId, t.createdAt),
    uniqueIndex("dot_run_run_uidx").on(t.runId),
    check("dot_run_trigger", oneOf(t.trigger, dotRunTriggerSchema.options)),
    check(
      "dot_run_outcome",
      sql`${t.outcome} is null or ${oneOf(t.outcome, scheduleRunOutcomeSchema.options)}`
    ),
    check(
      "dot_run_skip_reason",
      sql`${t.skipReason} is null or ${oneOf(t.skipReason, scheduleSkipReasonSchema.options)}`
    ),
    // A row is a claim, a run, or a skipped slot, never a mix.
    check(
      "dot_run_shape",
      sql`(${t.skipReason} is null and ${t.outcome} is distinct from 'skipped') or (${t.skipReason} is not null and ${t.outcome} is not distinct from 'skipped' and ${t.runId} is null)`
    ),
  ]
);
