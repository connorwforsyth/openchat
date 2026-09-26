import { z } from "zod";

import { conflictError } from "../errors";
import {
  conversationIdSchema,
  messageIdSchema,
  pageInputSchema,
  pageOf,
} from "../schemas/common";
import {
  branchPathSchema,
  messageSchema,
  messageTreeSchema,
} from "../schemas/messages";
import { authed } from "./base";

export const messages = {
  delete: authed
    .errors(conflictError)
    .route({
      description:
        "Deletes the message and everything below it. `CONFLICT` (`run_active`) while a run is writing on that branch.",
      method: "DELETE",
      path: "/messages/{id}",
      successStatus: 204,
      summary: "Delete a message and its descendants",
    })
    .input(z.object({ id: messageIdSchema }))
    .output(z.void()),
  get: authed
    .route({ method: "GET", path: "/messages/{id}", summary: "Get a message" })
    .input(z.object({ id: messageIdSchema }))
    .output(messageSchema),
  list: authed
    .route({
      description: "Every message, oldest first, for export and sync.",
      method: "GET",
      path: "/conversations/{conversationId}/messages",
      summary: "List messages",
    })
    .input(pageInputSchema.extend({ conversationId: conversationIdSchema }))
    .output(pageOf(messageSchema)),
  path: authed
    .route({
      description:
        "One branch, root first, with sibling info for the branch switcher. Omitting `leafId` uses the caller's active leaf, then the newest leaf.",
      method: "GET",
      path: "/conversations/{conversationId}/path",
      summary: "Get a branch",
    })
    .input(
      z.object({
        conversationId: conversationIdSchema,
        leafId: messageIdSchema.optional(),
      })
    )
    .output(branchPathSchema),
  tree: authed
    .route({
      description: "The tree's shape without content.",
      method: "GET",
      path: "/conversations/{conversationId}/tree",
      summary: "Get the message tree",
    })
    .input(z.object({ conversationId: conversationIdSchema }))
    .output(messageTreeSchema),
};
