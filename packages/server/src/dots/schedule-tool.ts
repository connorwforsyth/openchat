import {
  MANAGE_SCHEDULES_TOOL,
  resolveWhen,
  SCHEDULE_TASK_TOOL,
  type ScheduleTaskInput,
  scheduleTaskInputSchema,
} from "@workspace/ai/schedules/tool";
import type { DotScheduleId } from "@workspace/contract/schemas/common";
import type {
  CreateScheduleInput,
  Schedule,
} from "@workspace/contract/schemas/schedules";
import { err, type Result } from "@workspace/shared/result";
import { type Tool, tool } from "ai";
import { z } from "zod";

// A Dot schedules its own work from the conversation (172, 183): "every
// weekday at 8, brief me" becomes a schedule without the form. Two tools,
// so the approval sits on the one that adds work: `schedule_task` (the chat
// shows the call as a Proposed schedule card; Apply is the approval, and an
// unattended run is refused unless the owner auto-approves it) and
// `manage_scheduled_tasks` (list, pause, resume; never asks: it only reads
// or stops the Dot's own work).

/** What the tools reach: this Dot's schedules only. A port, so tests fake it. */
export interface DotSchedulesPort {
  readonly create: (
    input: CreateScheduleInput
  ) => Promise<Result<Schedule, string>>;
  readonly list: () => Promise<readonly Schedule[]>;
  readonly now: () => Date;
  readonly setEnabled: (
    id: DotScheduleId,
    enabled: boolean
  ) => Promise<Result<Schedule, string>>;
}

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
const brief = (schedule: Schedule) => ({
  id: schedule.id,
  nextRunAt: schedule.nextRunNominalAt,
  prompt: schedule.prompt,
  recurrence: schedule.recurrence,
  status: schedule.status,
  title: schedule.title,
});

const failed = (message: string) => ({ error: message, ok: false as const });

/** A proposal as the schedule it creates: the Dot's thread, read-write. */
export const proposalToSchedule = (
  input: ScheduleTaskInput,
  now: Date
): Result<CreateScheduleInput, string> => {
  const recurrence = resolveWhen(input.when, input.timezone, now);
  if (!recurrence.ok) {
    return err(
      recurrence.error === "in_past"
        ? "That time has already passed; pick a later one."
        : `Couldn't read "${input.when}" as a time. Try plain English like "every weekday at 9am", or an RRULE.`
    );
  }
  return {
    ok: true,
    value: {
      autoApproveTools: [],
      missedRunPolicy: "run_once",
      notify: input.notify,
      paused: false,
      prompt: input.prompt,
      recurrence: recurrence.value,
      target: { kind: "dot" },
      title: input.title,
    },
  };
};

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
      "Propose a scheduled task: the owner sees it as a card and applies it. When it fires, its prompt is posted in this chat and you do the task unattended. Use it when the user asks for something regularly or at a later time.",
    execute: async (input) => {
      const proposal = proposalToSchedule(input, port.now());
      if (!proposal.ok) {
        return failed(proposal.error);
      }
      const created = await port.create(proposal.value);
      return created.ok
        ? { ok: true as const, schedule: brief(created.value) }
        : failed(created.error);
    },
    inputSchema: scheduleTaskInputSchema,
  }),
});
