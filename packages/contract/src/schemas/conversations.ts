import { z } from "zod";

import {
  conversationIdSchema,
  messageIdSchema,
  pageInputSchema,
  runIdSchema,
  timestampSchema,
  userIdSchema,
} from "./common";
import { chatModeSchema, runStatusSchema, runTargetSchema } from "./runs";
import { conversationScheduleSchema } from "./schedules";
import {
  chatContextSchema,
  chatContextTypeSchema,
  userSummarySchema,
} from "./tenancy";

// Conversations (D17, D25). Access comes only from `resource_grant`
// (`viewer | editor`; the owner is always an editor). Participant rows hold
// per-user state and grant nothing.

/** The caller's effective access, derived from ownership and grants. */
export const conversationPermissionSchema = z.enum([
  "owner",
  "editor",
  "viewer",
]);
export type ConversationPermission = z.infer<
  typeof conversationPermissionSchema
>;

/** Derived from grants and share links; not stored or set directly. */
export const conversationVisibilitySchema = z.enum([
  "private",
  "shared",
  "public-link",
]);

/** Per-user state in a conversation (`conversation_participant`). */
export const participantStateSchema = z.object({
  /** The leaf of the branch this user is looking at; `null` means the newest leaf. */
  activeLeafId: messageIdSchema.nullable(),
  /** Collaboration wave: follow another participant's branch position. */
  followingUserId: userIdSchema.nullable(),
  lastReadAt: timestampSchema.nullable(),
  userId: userIdSchema,
});
export type ParticipantState = z.infer<typeof participantStateSchema>;

export const conversationSchema = z.object({
  archived: z.boolean(),
  context: chatContextSchema,
  /** True from the first message on; the context can't change after that. */
  contextLocked: z.boolean(),
  createdAt: timestampSchema,
  /** Used when a run doesn't name a target. */
  defaultTarget: runTargetSchema.nullable(),
  id: conversationIdSchema,
  lastMessageAt: timestampSchema.nullable(),
  /**
   * Chat or Code; new chats start in `chat`. A change applies from the next
   * message. Absent from servers before it, which read as `chat`.
   */
  mode: chatModeSchema.default("chat").optional(),
  myPermission: conversationPermissionSchema,
  myState: participantStateSchema,
  ownerId: userIdSchema,
  pinned: z.boolean(),
  /**
   * The soonest active schedule posting into this chat (173a), for "Next
   * run …" on the sidebar row and in the header. Absent from servers before it.
   */
  schedule: conversationScheduleSchema.nullable().optional(),
  /** `null` until the title job names it. */
  title: z.string().max(200).nullable(),
  updatedAt: timestampSchema,
  visibility: conversationVisibilitySchema,
});
export type Conversation = z.infer<typeof conversationSchema>;

export const createConversationInputSchema = z.object({
  context: chatContextSchema.default({ type: "personal" }),
  defaultTarget: runTargetSchema.optional(),
  mode: chatModeSchema.default("chat"),
  title: z.string().trim().min(1).max(200).optional(),
});

export const updateConversationInputSchema = z.object({
  archived: z.boolean().optional(),
  defaultTarget: runTargetSchema.nullable().optional(),
  id: conversationIdSchema,
  /** Applies from the next message; a run already going keeps its mode. */
  mode: chatModeSchema.optional(),
  pinned: z.boolean().optional(),
  title: z.string().trim().min(1).max(200).optional(),
});

/** Before the first message only; afterwards a `CONFLICT` (`context_locked`). */
export const setConversationContextInputSchema = z.object({
  context: chatContextSchema,
  id: conversationIdSchema,
});

export const listConversationsInputSchema = pageInputSchema.extend({
  archived: z.boolean().default(false),
  contextType: chatContextTypeSchema.optional(),
  /** `shared`: conversations other people granted the caller. */
  ownership: z.enum(["mine", "shared", "all"]).default("all"),
  pinned: z.boolean().optional(),
});

/** Copies the branch ending at `leafId` into a new conversation owned by the caller. */
export const forkConversationInputSchema = z.object({
  context: chatContextSchema.optional(),
  id: conversationIdSchema,
  leafId: messageIdSchema,
  title: z.string().trim().min(1).max(200).optional(),
});

export const updateParticipantStateInputSchema = z.object({
  activeLeafId: messageIdSchema.nullable().optional(),
  conversationId: conversationIdSchema,
  followingUserId: userIdSchema.nullable().optional(),
  lastReadAt: timestampSchema.optional(),
});

export const participantSchema = z.object({
  permission: conversationPermissionSchema,
  state: participantStateSchema,
  user: userSummarySchema,
});
export type Participant = z.infer<typeof participantSchema>;

/**
 * One event on a conversation's live channel (D25,
 * `GET /conversations/{id}/events`): what another participant did, so an
 * open chat catches up without a reload. Events are hints, not a log: a
 * client refetches the branch or follows the run they name, and on
 * reconnect it refetches rather than replaying.
 *
 * - `message`: a message was stored (a person's turn, or a finished answer).
 * - `run`: a run was created or changed status; `running` is the cue to
 *   follow its stream (`GET /runs/{id}/stream`).
 * - `presence`: everyone with the chat open now, the caller included.
 * - `typing`: a participant is writing a message; it lapses after a few
 *   seconds without another.
 */
export const conversationEventSchema = z.discriminatedUnion("type", [
  z.object({
    authorId: userIdSchema.nullable(),
    messageId: messageIdSchema,
    type: z.literal("message"),
  }),
  z.object({
    runId: runIdSchema,
    status: runStatusSchema,
    type: z.literal("run"),
  }),
  z.object({
    type: z.literal("presence"),
    users: z.array(userSummarySchema),
  }),
  z.object({
    type: z.literal("typing"),
    user: userSummarySchema,
  }),
]);
export type ConversationEvent = z.infer<typeof conversationEventSchema>;

/** How long a `typing` event holds before it lapses, in milliseconds. */
export const TYPING_TTL_MS = 5000;
