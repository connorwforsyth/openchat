import { z } from "zod";

import {
  conversationIdSchema,
  messageIdSchema,
  pageInputSchema,
  timestampSchema,
  userIdSchema,
} from "./common";
import { runTargetSchema } from "./runs";
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
  myPermission: conversationPermissionSchema,
  myState: participantStateSchema,
  ownerId: userIdSchema,
  pinned: z.boolean(),
  /** `null` until the title job names it. */
  title: z.string().max(200).nullable(),
  updatedAt: timestampSchema,
  visibility: conversationVisibilitySchema,
});
export type Conversation = z.infer<typeof conversationSchema>;

export const createConversationInputSchema = z.object({
  context: chatContextSchema.default({ type: "personal" }),
  defaultTarget: runTargetSchema.optional(),
  title: z.string().trim().min(1).max(200).optional(),
});

export const updateConversationInputSchema = z.object({
  archived: z.boolean().optional(),
  defaultTarget: runTargetSchema.nullable().optional(),
  id: conversationIdSchema,
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
