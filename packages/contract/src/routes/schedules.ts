import { z } from "zod";

import {
  budgetError,
  conflictError,
  featureError,
  providerError,
} from "../errors";
import { dotScheduleIdSchema } from "../schemas/common";
import { createRunOutputSchema } from "../schemas/runs";
import {
  createScheduleInputSchema,
  listSchedulesInputSchema,
  runScheduleNowInputSchema,
  scheduleLimitsSchema,
  scheduleRunSchema,
  scheduleRunsInputSchema,
  scheduleSchema,
  updateScheduleInputSchema,
} from "../schemas/schedules";
import { authed } from "./base";

const byId = z.object({ id: dotScheduleIdSchema });

// Schedules (173a): the owner's scheduled tasks, whatever they target. Only
// the owner sees or edits one; anyone else gets `NOT_FOUND`.
// `FEATURE_DISABLED` means the instance has no job queue, so nothing fires.
// A recurrence more often than the instance's minimum interval, a one-off
// in the past or over two years out, or an unsupported RRULE part is a
// `VALIDATION` error on `recurrence`.

export const schedules = {
  create: authed
    .errors(featureError)
    .route({
      description:
        "Creates a schedule. A `conversation` target must be a chat the caller can write; a `dot` target needs the caller's Dot. Read-only unless it targets the Dot, or `readOnly: false`.",
      method: "POST",
      path: "/schedules",
      successStatus: 201,
      summary: "Create a schedule",
    })
    .input(createScheduleInputSchema)
    .output(scheduleSchema),
  delete: authed
    .route({
      description:
        "Deletes the schedule and stops future runs. Its run history goes with it; the runs' messages stay.",
      method: "DELETE",
      path: "/schedules/{id}",
      successStatus: 204,
      summary: "Delete a schedule",
    })
    .input(byId)
    .output(z.void()),
  get: authed
    .route({
      method: "GET",
      path: "/schedules/{id}",
      summary: "Get a schedule",
    })
    .input(byId)
    .output(scheduleSchema),
  limits: authed
    .route({
      description:
        "The guardrails on the caller's schedules (minimum interval, daily run cap, per-run step and token budgets, the default model) and the runs used in the last 24 hours.",
      method: "GET",
      path: "/schedule-limits",
      summary: "Schedule limits and usage",
    })
    .input(z.object({}))
    .output(scheduleLimitsSchema),
  list: authed
    .route({
      description:
        "The caller's schedules, active first and then by next run, then paused and completed.",
      method: "GET",
      path: "/schedules",
      summary: "List schedules",
    })
    .input(listSchedulesInputSchema)
    .output(z.array(scheduleSchema)),
  markRunsRead: authed
    .route({
      description: "Marks every run of the schedule read.",
      method: "POST",
      path: "/schedules/{id}/runs/read",
      summary: "Mark a schedule's runs read",
    })
    .input(byId)
    .output(z.void()),
  pause: authed
    .route({
      method: "POST",
      path: "/schedules/{id}/pause",
      summary: "Pause a schedule",
    })
    .input(byId)
    .output(scheduleSchema),
  resume: authed
    .errors(conflictError)
    .route({
      description:
        "Resumes from the next slot after now (missed slots aren't replayed). A schedule with no slot left (a fired one-off, or a rule past its `endsAt`) is a `CONFLICT` (`schedule_completed`); one whose target chat is archived, or gone for its owner, is a `CONFLICT` (`target_archived`).",
      method: "POST",
      path: "/schedules/{id}/resume",
      summary: "Resume a schedule",
    })
    .input(byId)
    .output(scheduleSchema),
  runNow: authed
    .errors({
      ...conflictError,
      ...budgetError,
      ...providerError,
      ...featureError,
    })
    .route({
      description:
        "Runs the saved prompt once, now, unattended, as a slot would. Counts toward the daily cap (`RATE_LIMITED` when it's used up). A target with a run in flight is a `CONFLICT` (`run_active`), and one that is archived, or gone for its owner, is a `CONFLICT` (`target_archived`).",
      method: "POST",
      path: "/schedules/{id}/run",
      successStatus: 202,
      summary: "Run a schedule now",
    })
    .input(runScheduleNowInputSchema)
    .output(createRunOutputSchema),
  runs: authed
    .route({
      description:
        "The schedule's run history, newest first, including skipped slots and why.",
      method: "GET",
      path: "/schedules/{id}/runs",
      summary: "A schedule's runs",
    })
    .input(scheduleRunsInputSchema)
    .output(z.array(scheduleRunSchema)),
  update: authed
    .errors(featureError)
    .route({
      description:
        "Changes take effect from the next slot. Changing the recurrence recomputes the next run.",
      method: "PATCH",
      path: "/schedules/{id}",
      summary: "Update a schedule",
    })
    .input(updateScheduleInputSchema)
    .output(scheduleSchema),
};
