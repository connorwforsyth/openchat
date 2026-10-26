import { z } from "zod";

import {
  budgetError,
  conflictError,
  featureError,
  providerError,
} from "../errors";
import {
  conversationIdSchema,
  pageInputSchema,
  pageOf,
  runIdSchema,
} from "../schemas/common";
import {
  createRunInputSchema,
  createRunOutputSchema,
  runSchema,
  submitApprovalsInputSchema,
} from "../schemas/runs";
import { authed } from "./base";

export const runs = {
  cancel: authed
    .errors(conflictError)
    .route({
      description:
        "Stops a queued, running or waiting run. `CONFLICT` (`run_finished`) if it already ended.",
      method: "POST",
      path: "/runs/{id}/cancel",
      summary: "Cancel a run",
    })
    .input(z.object({ id: runIdSchema }))
    .output(runSchema),
  create: authed
    .errors({
      ...conflictError,
      ...budgetError,
      ...providerError,
      ...featureError,
    })
    .route({
      description:
        "Persists the user message and starts (or queues) a run. Returns at once; stream the reply from `streamUrl` (`GET /runs/{id}/stream`, AI SDK UI message stream over SSE).",
      method: "POST",
      path: "/runs",
      successStatus: 202,
      summary: "Start a run",
    })
    .input(createRunInputSchema)
    .output(createRunOutputSchema),
  get: authed
    .route({ method: "GET", path: "/runs/{id}", summary: "Get a run" })
    .input(z.object({ id: runIdSchema }))
    .output(runSchema),
  list: authed
    .route({
      description:
        "Runs in a conversation, newest first. `active` keeps unfinished ones (the queue).",
      method: "GET",
      path: "/conversations/{conversationId}/runs",
      summary: "List runs in a conversation",
    })
    .input(
      pageInputSchema.extend({
        active: z.boolean().optional(),
        conversationId: conversationIdSchema,
      })
    )
    .output(pageOf(runSchema)),
  steer: authed
    .errors(conflictError)
    .route({
      description:
        "Asks a queued turn to steer the answer it waits on: that answer takes it at its next step. If the answer ends first, the turn runs next as queued. `CONFLICT` (`run_active` or `run_finished`) if it isn't queued any more.",
      method: "POST",
      path: "/runs/{id}/steer",
      summary: "Steer with a queued turn",
    })
    .input(z.object({ id: runIdSchema }))
    .output(runSchema),
  submitApprovals: authed
    .errors(conflictError)
    .route({
      description:
        "Approve, reject or review (per hunk) pending tool calls. Any editor may decide. `CONFLICT` (`not_awaiting_approval`) if nothing is pending.",
      method: "POST",
      path: "/runs/{runId}/approvals",
      summary: "Decide pending tool calls",
    })
    .input(submitApprovalsInputSchema)
    .output(runSchema),
  withdraw: authed
    .errors(conflictError)
    .route({
      description:
        "Takes back a queued turn before it starts: the run is cancelled and its message removed, unless another turn already follows it. `CONFLICT` (`run_active` or `run_finished`) if it isn't queued any more.",
      method: "POST",
      path: "/runs/{id}/withdraw",
      summary: "Withdraw a queued turn",
    })
    .input(z.object({ id: runIdSchema }))
    .output(z.object({ messageRemoved: z.boolean(), run: runSchema })),
};
