import type { ScheduleRecurrence } from "@workspace/contract/schemas/schedules";
import {
  scheduleEmojiSchema,
  scheduleNotifySchema,
  schedulePromptSchema,
  scheduleTimeZoneSchema,
  scheduleTitleSchema,
} from "@workspace/contract/schemas/schedules";
import { err, ok, type Result } from "@workspace/shared/result";
import { z } from "zod";

import { parseWhen } from "./parse-when";
import { parseRrule } from "./recurrence";

const RRULE_PREFIX = /^RRULE:/i;

// The schedule tools' shared half (173, 183): their names and input
// schemas, and how a proposal's `when` becomes a recurrence. The server runs
// the tools; the chat renders a `schedule_task` call as a Proposed schedule
// card from the same schema, so both read a proposal the same way.

export const SCHEDULE_TASK_TOOL = "schedule_task";
/** How an unattended run says what it found (175); the chat shows it as one line. */
export const REPORT_TOOL = "report_outcome";

export const reportInputSchema = z.object({
  outcome: z
    .enum(["update", "no_update", "needs_attention"])
    .describe(
      "`needs_attention`: the owner should act or decide something. `update`: something new worth telling them. `no_update`: nothing changed, nothing to say."
    ),
  summary: z
    .string()
    .max(280)
    .optional()
    .describe("One line for the owner's list, e.g. `2 new emails from Sam`."),
});

/** The data part a scheduled run's message carries: "Sent by scheduled task". */
export const SCHEDULED_TASK_DATA = "scheduled-task";

export const scheduledTaskDataSchema = z.object({
  /** Absent on messages sent before schedules had one, and on a Dot's "Run now". */
  emoji: scheduleEmojiSchema.optional(),
  scheduleId: z.string().nullable(),
  title: z.string(),
});
export const MANAGE_SCHEDULES_TOOL = "manage_scheduled_tasks";

export const scheduleTaskInputSchema = z.object({
  notify: scheduleNotifySchema
    .describe(
      "When to tell the owner: `important` (only when they should act, the default), `all` (every run with news), `failures` (only failed runs)."
    )
    .default("important"),
  prompt: schedulePromptSchema.describe(
    "What to do each time, written as the message you will receive when it fires."
  ),
  timezone: scheduleTimeZoneSchema
    .describe("IANA time zone the time is in, e.g. `Europe/London`.")
    .default("UTC"),
  title: scheduleTitleSchema
    .describe("A short name for the task, like `Morning brief`.")
    .default("Scheduled task"),
  when: z
    .string()
    .trim()
    .min(2)
    .max(200)
    .describe(
      "When it runs: plain English (`every weekday at 9am`, `tomorrow at 8:30`, `every 2 hours`) or an RRULE (`FREQ=DAILY;BYHOUR=8;BYMINUTE=0`)."
    ),
});
export type ScheduleTaskInput = z.infer<typeof scheduleTaskInputSchema>;

const RRULE_LIKE = /^(RRULE:)?FREQ=/i;

/**
 * A proposal's `when` as a recurrence in `timezone`, anchored at `now`: an
 * RRULE as given, else the plain-English parser. `null` when it's neither.
 */
export const resolveWhen = (
  when: string,
  timezone: string,
  now: Date
): Result<ScheduleRecurrence, "unrecognised" | "in_past"> => {
  if (RRULE_LIKE.test(when.trim())) {
    const parts = parseRrule(when);
    return parts.ok
      ? ok({
          endsAt: null,
          kind: "rrule",
          rrule: when.trim().replace(RRULE_PREFIX, ""),
          startAt: now.toISOString(),
          timezone,
        })
      : err("unrecognised");
  }
  const parsed = parseWhen(when, { now, timezone });
  return parsed.ok ? parsed : err(parsed.error.type);
};
