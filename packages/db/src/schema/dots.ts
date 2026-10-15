import { dotRunTriggerSchema } from "@workspace/contract/schemas/dots";
import {
  type RunTarget,
  runStatusSchema,
} from "@workspace/contract/schemas/runs";
import type { SandboxProvider } from "@workspace/contract/schemas/sandbox";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
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

// Dots (172): always-on agents with cron schedules. A Dot owns one
// conversation; every scheduled or manual run lands in it. Which schedule is
// due is decided here (`next_run_at`), not by pg-boss: a once-a-minute tick
// claims due rows, so any number of schedules share one queue.

export const dot = pgTable(
  "dot",
  {
    /** Tools it may run unattended even where its agent says `ask`. */
    autoApproveTools: jsonb("auto_approve_tools")
      .$type<string[]>()
      .notNull()
      .default([]),
    conversationId: idRef("conversation_id", "conversation")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    enabled: boolean("enabled").notNull().default(true),
    id: idColumn("dot"),
    instructions: text("instructions").notNull().default(""),
    /** When the owner last opened it; a run finished later is unread. */
    lastViewedAt: instant("last_viewed_at"),
    name: text("name").notNull(),
    ownerId: idRef("owner_id", "user")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** `null` means the instance default. */
    sandboxProvider: text("sandbox_provider").$type<SandboxProvider>(),
    target: jsonb("target").$type<RunTarget>().notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("dot_owner_idx").on(t.ownerId, t.createdAt),
    uniqueIndex("dot_conversation_uidx").on(t.conversationId),
  ]
);

export const dotSchedule = pgTable(
  "dot_schedule",
  {
    createdAt: createdAt(),
    cron: text("cron").notNull(),
    dotId: idRef("dot_id", "dot")
      .notNull()
      .references(() => dot.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(true),
    id: idColumn("dotSchedule"),
    lastRunAt: instant("last_run_at"),
    lastStatus:
      text("last_status").$type<(typeof runStatusSchema.options)[number]>(),
    /** `null` while disabled; the tick fires rows at or before now. */
    nextRunAt: instant("next_run_at"),
    prompt: text("prompt").notNull(),
    timezone: text("timezone").notNull().default("UTC"),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("dot_schedule_dot_idx").on(t.dotId),
    index("dot_schedule_due_idx")
      .on(t.nextRunAt)
      .where(sql`${t.enabled} and ${t.nextRunAt} is not null`),
    check(
      "dot_schedule_last_status",
      sql`${t.lastStatus} is null or ${oneOf(t.lastStatus, runStatusSchema.options)}`
    ),
  ]
);

/** Which runs a Dot started, and why: the run row holds the rest. */
export const dotRun = pgTable(
  "dot_run",
  {
    createdAt: createdAt(),
    dotId: idRef("dot_id", "dot")
      .notNull()
      .references(() => dot.id, { onDelete: "cascade" }),
    id: idColumn("dotRun"),
    runId: idRef("run_id", "run")
      .notNull()
      .references(() => run.id, { onDelete: "cascade" }),
    scheduleId: idRef("schedule_id", "dotSchedule").references(
      () => dotSchedule.id,
      { onDelete: "set null" }
    ),
    trigger: text("trigger")
      .$type<(typeof dotRunTriggerSchema.options)[number]>()
      .notNull(),
  },
  (t) => [
    index("dot_run_dot_idx").on(t.dotId, t.createdAt),
    uniqueIndex("dot_run_run_uidx").on(t.runId),
    check("dot_run_trigger", oneOf(t.trigger, dotRunTriggerSchema.options)),
  ]
);
