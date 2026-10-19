import { z } from "zod";

import {
  budgetError,
  conflictError,
  featureError,
  providerError,
} from "../errors";
import { dotIdSchema, dotScheduleIdSchema } from "../schemas/common";
import {
  createDotInputSchema,
  createDotScheduleInputSchema,
  dotActivityInputSchema,
  dotActivitySchema,
  dotScheduleSchema,
  dotSchema,
  runDotNowInputSchema,
  updateDotInputSchema,
  updateDotScheduleInputSchema,
} from "../schemas/dots";
import { createRunOutputSchema } from "../schemas/runs";
import { authed } from "./base";

const byId = z.object({ id: dotIdSchema });

// Dots (172): always-on agents with schedules. Only the owner sees or edits a
// Dot; anyone else gets `NOT_FOUND`. `FEATURE_DISABLED` means the instance has
// no job queue, so schedules can't fire.

export const dots = {
  activity: authed
    .route({
      description:
        "The runs the Dot started, newest first: what triggered each, how it ended and the start of its reply.",
      method: "GET",
      path: "/dots/{id}/activity",
      summary: "A Dot's activity",
    })
    .input(dotActivityInputSchema)
    .output(z.array(dotActivitySchema)),
  create: authed
    .errors({ ...conflictError, ...featureError })
    .route({
      description:
        "Creates the caller's Dot, its conversation and its schedules. An owner has one Dot: a second is a `CONFLICT` (`already_exists`).",
      method: "POST",
      path: "/dots",
      successStatus: 201,
      summary: "Create a Dot",
    })
    .input(createDotInputSchema)
    .output(dotSchema),
  createSchedule: authed
    .errors(featureError)
    .route({
      method: "POST",
      path: "/dots/{dotId}/schedules",
      successStatus: 201,
      summary:
        "Add a schedule to a Dot (alias of `schedules.create` with a cron)",
    })
    .input(createDotScheduleInputSchema)
    .output(dotScheduleSchema),
  delete: authed
    .route({
      description:
        "Deletes the Dot and its schedules. Its conversation stays, as a normal chat. Deleting the primary Dot makes the newest remaining one primary.",
      method: "DELETE",
      path: "/dots/{id}",
      successStatus: 204,
      summary: "Delete a Dot",
    })
    .input(byId)
    .output(z.void()),
  deleteSchedule: authed
    .route({
      method: "DELETE",
      path: "/dot-schedules/{id}",
      successStatus: 204,
      summary: "Delete a Dot schedule (alias of `schedules.delete`)",
    })
    .input(z.object({ id: dotScheduleIdSchema }))
    .output(z.void()),
  get: authed
    .route({ method: "GET", path: "/dots/{id}", summary: "Get a Dot" })
    .input(byId)
    .output(dotSchema),
  list: authed
    .route({
      description:
        "The caller's Dot, as a list of at most one (174), with unread and attention state.",
      method: "GET",
      path: "/dots",
      summary: "List Dots",
    })
    .input(z.object({}))
    .output(z.array(dotSchema)),
  markRead: authed
    .route({
      description: "Clears `unread`: the owner has seen the latest run.",
      method: "POST",
      path: "/dots/{id}/read",
      summary: "Mark a Dot read",
    })
    .input(byId)
    .output(dotSchema),
  runNow: authed
    .errors({
      ...conflictError,
      ...budgetError,
      ...providerError,
      ...featureError,
    })
    .route({
      description:
        "Posts the prompt into the Dot's conversation and starts a run, as a schedule would. Unattended rules apply: `ask` tools the Dot hasn't auto-approved are refused, never waited on.",
      method: "POST",
      path: "/dots/{id}/run",
      successStatus: 202,
      summary: "Run a Dot now",
    })
    .input(runDotNowInputSchema)
    .output(createRunOutputSchema),
  update: authed
    .errors(featureError)
    .route({
      description:
        "A handle another of the caller's Dots has is a `VALIDATION` error on `handle`. `primary: true` moves the primary mark here.",
      method: "PATCH",
      path: "/dots/{id}",
      summary: "Update a Dot",
    })
    .input(updateDotInputSchema)
    .output(dotSchema),
  updateSchedule: authed
    .errors(featureError)
    .route({
      method: "PATCH",
      path: "/dot-schedules/{id}",
      summary: "Update a Dot schedule (alias of `schedules.update`)",
    })
    .input(updateDotScheduleInputSchema)
    .output(dotScheduleSchema),
};
