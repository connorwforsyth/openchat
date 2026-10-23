import { z } from "zod";

import { conflictError } from "../errors";
import { conversationIdSchema, pageOf } from "../schemas/common";
import {
  conversationSchema,
  createConversationInputSchema,
  forkConversationInputSchema,
  listConversationsInputSchema,
  participantSchema,
  participantStateSchema,
  setConversationContextInputSchema,
  updateConversationInputSchema,
  updateParticipantStateInputSchema,
} from "../schemas/conversations";
import { authed } from "./base";

const byId = z.object({ id: conversationIdSchema });

export const conversations = {
  create: authed
    .route({
      method: "POST",
      path: "/conversations",
      successStatus: 201,
      summary: "Create a conversation",
    })
    .input(createConversationInputSchema)
    .output(conversationSchema),
  delete: authed
    .route({
      method: "DELETE",
      path: "/conversations/{id}",
      successStatus: 204,
      summary: "Delete a conversation",
    })
    .input(byId)
    .output(z.void()),
  fork: authed
    .route({
      description:
        "Copies the branch ending at `leafId` into a new conversation owned by the caller.",
      method: "POST",
      path: "/conversations/{id}/fork",
      successStatus: 201,
      summary: "Fork a branch into a new conversation",
    })
    .input(forkConversationInputSchema)
    .output(conversationSchema),
  get: authed
    .route({
      method: "GET",
      path: "/conversations/{id}",
      summary: "Get a conversation",
    })
    .input(byId)
    .output(conversationSchema),
  list: authed
    .route({
      method: "GET",
      path: "/conversations",
      summary: "List conversations",
    })
    .input(listConversationsInputSchema)
    .output(pageOf(conversationSchema)),
  participants: authed
    .route({
      method: "GET",
      path: "/conversations/{id}/participants",
      summary: "List participants",
    })
    .input(byId)
    .output(z.array(participantSchema)),
  setContext: authed
    .errors(conflictError)
    .route({
      description:
        "Changes the chat context. Only before the first message; afterwards `CONFLICT` (`context_locked`).",
      method: "PUT",
      path: "/conversations/{id}/context",
      summary: "Set the chat context",
    })
    .input(setConversationContextInputSchema)
    .output(conversationSchema),
  typing: authed
    .route({
      description:
        "Tells the chat's other participants the caller is writing a message (a `typing` event on `GET /conversations/{id}/events`). Send it again while they keep typing; it lapses after `TYPING_TTL_MS`.",
      method: "POST",
      path: "/conversations/{id}/typing",
      successStatus: 204,
      summary: "Say the caller is typing",
    })
    .input(byId)
    .output(z.void()),
  update: authed
    .route({
      method: "PATCH",
      path: "/conversations/{id}",
      summary: "Update a conversation",
    })
    .input(updateConversationInputSchema)
    .output(conversationSchema),
  updateMyState: authed
    .route({
      description:
        "The caller's branch position, follow target and read marker.",
      method: "PATCH",
      path: "/conversations/{conversationId}/participants/me",
      summary: "Update the caller's participant state",
    })
    .input(updateParticipantStateInputSchema)
    .output(participantStateSchema),
};
