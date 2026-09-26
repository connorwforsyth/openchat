import { z } from "zod";

import {
  conversationIdSchema,
  memoryVersionIdSchema,
  messageIdSchema,
  runIdSchema,
  timestampSchema,
} from "./common";

// Memory (D20): one Markdown file per user, injected into every chat up to a
// size cap. The agent edits it with the `update_memory` tool; every change is a
// `memory_version`, so "Memory updated · Undo" is a revert. Never written from
// shared or multi-user chats.

/** `auto` applies agent edits at once; `propose` turns them into an approval with a diff. */
export const memoryModeSchema = z.enum(["auto", "propose"]);
export type MemoryMode = z.infer<typeof memoryModeSchema>;

export const memoryDocumentSchema = z.object({
  content: z.string(),
  /** The cap from `limits.memoryMaxChars`; content past it isn't injected. */
  maxChars: z.int().min(1),
  mode: memoryModeSchema,
  updatedAt: timestampSchema.nullable(),
  /** `null` before the first write. */
  versionId: memoryVersionIdSchema.nullable(),
});
export type MemoryDocument = z.infer<typeof memoryDocumentSchema>;

export const memoryVersionSourceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("user") }),
  z.object({
    conversationId: conversationIdSchema,
    messageId: messageIdSchema,
    runId: runIdSchema,
    type: z.literal("agent"),
  }),
  z.object({ fromVersionId: memoryVersionIdSchema, type: z.literal("revert") }),
]);

export const memoryVersionSchema = z.object({
  content: z.string(),
  createdAt: timestampSchema,
  id: memoryVersionIdSchema,
  number: z.int().min(1),
  source: memoryVersionSourceSchema,
});
export type MemoryVersion = z.infer<typeof memoryVersionSchema>;

/**
 * One edit to the memory file. Text matches are exact; a `find` that doesn't
 * occur (or occurs more than once) fails the whole update, so the model never
 * edits the wrong line.
 */
export const memoryPatchSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("append"), text: z.string().min(1).max(4000) }),
  z.object({
    find: z.string().min(1).max(4000),
    op: z.literal("replace"),
    replace: z.string().max(4000),
  }),
  z.object({ find: z.string().min(1).max(4000), op: z.literal("delete") }),
]);
export type MemoryPatch = z.infer<typeof memoryPatchSchema>;

/** Input of the agent's `update_memory` tool. */
export const updateMemoryToolInputSchema = z.object({
  patches: z.array(memoryPatchSchema).min(1).max(20),
  /** One line for the "Memory updated" note, in the user's language. */
  summary: z.string().min(1).max(200),
});
export type UpdateMemoryToolInput = z.infer<typeof updateMemoryToolInputSchema>;

/** A direct edit in settings. A stale `baseVersionId` is a `CONFLICT` (`version_mismatch`). */
export const updateMemoryInputSchema = z.object({
  baseVersionId: memoryVersionIdSchema.nullable(),
  content: z.string().max(200_000),
});

/** Undo: a new version with the content of `versionId`. */
export const revertMemoryInputSchema = z.object({
  versionId: memoryVersionIdSchema,
});
