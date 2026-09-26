import { z } from "zod";

import {
  conversationIdSchema,
  libraryItemIdSchema,
  libraryVersionIdSchema,
  messageIdSchema,
  runIdSchema,
  timestampSchema,
  userIdSchema,
} from "./common";
import { messagePartSchema, partsVersionSchema } from "./message-parts";
import { modelRefSchema, tokenUsageSchema } from "./models";

// A conversation is a tree of messages linked by `parentId` (LibreChat's
// model). Editing or regenerating adds a sibling under the same parent; the
// branch the user sees is the path from the root to a leaf.

export const messageRoleSchema = z.enum(["user", "assistant", "system"]);
export type MessageRole = z.infer<typeof messageRoleSchema>;

/**
 * `partial`: the run stopped early (cancelled, or failed after streaming some
 * output); the parts are what arrived. `error`: nothing usable was produced.
 */
export const messageStatusSchema = z.enum(["complete", "partial", "error"]);
export type MessageStatus = z.infer<typeof messageStatusSchema>;

/** The agent version that answered, as it was when the run started. */
export const agentVersionRefSchema = z.object({
  id: libraryItemIdSchema,
  versionId: libraryVersionIdSchema,
});

export const messageSchema = z.object({
  /** Agent that produced an assistant message; `null` for plain model chats and user messages. */
  agent: agentVersionRefSchema.nullable(),
  /** The user who wrote it; `null` for assistant and system messages. */
  authorId: userIdSchema.nullable(),
  conversationId: conversationIdSchema,
  createdAt: timestampSchema,
  id: messageIdSchema,
  /** The model that produced an assistant message (resolved ref, never an alias). */
  model: modelRefSchema.nullable(),
  /** `null` for a root message. */
  parentId: messageIdSchema.nullable(),
  parts: z.array(messagePartSchema),
  partsVersion: partsVersionSchema,
  role: messageRoleSchema,
  /** The run that produced (assistant) or was started by (user) this message. */
  runId: runIdSchema.nullable(),
  status: messageStatusSchema,
  usage: tokenUsageSchema.nullable(),
});
export type Message = z.infer<typeof messageSchema>;

/**
 * The fields tree helpers (`buildBranchPath`, sibling lookup, fork) need. They
 * take this, not a full message, so they work on light tree listings too.
 */
export const messageNodeSchema = messageSchema.pick({
  createdAt: true,
  id: true,
  parentId: true,
  role: true,
});
export type MessageNode = z.infer<typeof messageNodeSchema>;

/** The whole tree's shape, without content: for the branch map and leaf lookup. */
export const messageTreeSchema = z.object({
  conversationId: conversationIdSchema,
  nodes: z.array(messageNodeSchema),
});
export type MessageTree = z.infer<typeof messageTreeSchema>;

/**
 * For the branch switcher: a message's siblings (children of the same parent,
 * oldest first) and its position among them ("2 / 3").
 */
export const siblingInfoSchema = z.object({
  index: z.int().min(0),
  messageId: messageIdSchema,
  siblingIds: z.array(messageIdSchema).min(1),
});
export type SiblingInfo = z.infer<typeof siblingInfoSchema>;

/** One branch, root first, plus sibling info for every message on it. */
export const branchPathSchema = z.object({
  conversationId: conversationIdSchema,
  /** `null` for an empty conversation. */
  leafId: messageIdSchema.nullable(),
  messages: z.array(messageSchema),
  siblings: z.array(siblingInfoSchema),
});
export type BranchPath = z.infer<typeof branchPathSchema>;
