import type { DotScheduleId } from "@workspace/contract/schemas/common";
import {
  cronExpressionSchema,
  type DotSchedule,
  dotPromptSchema,
  timeZoneSchema,
} from "@workspace/contract/schemas/dots";
import type { Result } from "@workspace/shared/result";
import { type Tool, tool } from "ai";
import { z } from "zod";

// A Dot schedules its own work from the conversation (172): "every weekday
// at 8, brief me" becomes a schedule without the form. Two tools, so the
// approval can sit on the one that adds work: `schedule_task` (create; asks
// the owner when they're there, refused on an unattended run unless the
// owner auto-approves it) and `manage_scheduled_tasks` (list, pause,
// resume; never asks: it only reads or stops the Dot's own work).

export const SCHEDULE_TASK_TOOL = "schedule_task";
export const MANAGE_SCHEDULES_TOOL = "manage_scheduled_tasks";

/** What the tools reach: this Dot's schedules only. A port, so tests fake it. */
export interface DotSchedulesPort {
  readonly create: (input: {
    readonly cron: string;
    readonly prompt: string;
    readonly timezone: string;
  }) => Promise<Result<DotSchedule, string>>;
  readonly list: () => Promise<readonly DotSchedule[]>;
  readonly setEnabled: (
    id: DotScheduleId,
    enabled: boolean
  ) => Promise<Result<DotSchedule, string>>;
}

export const scheduleTaskInputSchema = z.object({
  cron: cronExpressionSchema.describe(
    "Five-field cron (minute hour day-of-month month day-of-week), e.g. `0 8 * * 1-5` for weekdays at 8:00."
  ),
  prompt: dotPromptSchema.describe(
    "What to do each time, written as the message you will receive when it fires."
  ),
  timezone: timeZoneSchema
    .describe("IANA time zone the cron is in, e.g. `Europe/London`.")
    .default("UTC"),
});

// One flat object, not a union: providers want an object at the root of a
// tool's input schema (Anthropic rejects a bare `oneOf`).
export const manageSchedulesInputSchema = z.object({
  action: z.enum(["list", "pause", "resume"]),
  scheduleId: z
    .string()
    .optional()
    .describe("For pause and resume: the `id` from a `list` result."),
});

/** What the model reads back: enough to talk about a schedule. */
const brief = (schedule: DotSchedule) => ({
  cron: schedule.cron,
  enabled: schedule.enabled,
  id: schedule.id,
  nextRunAt: schedule.nextRunAt,
  prompt: schedule.prompt,
  timezone: schedule.timezone,
});

const failed = (message: string) => ({ error: message, ok: false as const });

export const dotScheduleTools = (
  port: DotSchedulesPort
): Readonly<Record<string, Tool>> => ({
  [MANAGE_SCHEDULES_TOOL]: tool({
    description:
      "List your own scheduled tasks, or pause or resume one of them by id.",
    execute: async (input) => {
      if (input.action === "list") {
        return { ok: true as const, schedules: (await port.list()).map(brief) };
      }
      if (!input.scheduleId) {
        return failed("Say which scheduled task: pass its scheduleId.");
      }
      const owned = (await port.list()).some(
        (schedule) => schedule.id === input.scheduleId
      );
      if (!owned) {
        return failed("No scheduled task of yours has that id.");
      }
      const changed = await port.setEnabled(
        input.scheduleId as DotScheduleId,
        input.action === "resume"
      );
      return changed.ok
        ? { ok: true as const, schedule: brief(changed.value) }
        : failed(changed.error);
    },
    inputSchema: manageSchedulesInputSchema,
  }),
  [SCHEDULE_TASK_TOOL]: tool({
    description:
      "Schedule a recurring task for yourself. When it fires, its prompt is posted in this chat and you do the task unattended. Use it when the user asks for something regularly or at a later time.",
    execute: async (input) => {
      const created = await port.create(input);
      return created.ok
        ? { ok: true as const, schedule: brief(created.value) }
        : failed(created.error);
    },
    inputSchema: scheduleTaskInputSchema,
  }),
});
