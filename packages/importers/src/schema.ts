import {
  jsonValueSchema,
  timestampSchema,
} from "@workspace/contract/schemas/common";
import { messagePartSchema } from "@workspace/contract/schemas/message-parts";
import {
  messageRoleSchema,
  messageStatusSchema,
} from "@workspace/contract/schemas/messages";
import { modelRefSchema } from "@workspace/contract/schemas/models";
import { z } from "zod";

// The normalised form every importer produces and `persistImport` writes
// (PLAN.md D1, §8). Parsers are pure: export JSON in, these values out. Ids
// are still the export's own (`sourceId`); persisting mints fresh UUIDv7s and
// re-links parents, so an export can be imported twice without clashing.
//
// Values are plain JSON (ISO timestamps, no `Date`), so a parsed conversation
// can be queued as a background job payload and persisted later.

export const importSourceSchema = z.enum(["chatgpt", "claude", "librechat"]);
export type ImportSource = z.infer<typeof importSourceSchema>;

/** Titles are cut to the contract's conversation title limit. */
export const TITLE_MAX = 200;

/**
 * Size limits. An export is processed one conversation at a time
 * (`parseExportStream`), so memory is bounded by the largest conversation, not
 * the file: a ChatGPT `conversations.json` of several hundred MB is fine.
 */
export const IMPORT_LIMITS = {
  /**
   * The largest single conversation, in UTF-16 code units of its JSON (about
   * bytes for mostly-ASCII text). Bigger ones are skipped with `too_large`.
   */
  maxConversationChars: 64 * 1024 * 1024,
  /** Nodes in one conversation; ChatGPT's mapping counts hidden nodes too. */
  maxMessagesPerConversation: 20_000,
} as const;

export const importedMessageSchema = z.object({
  createdAt: timestampSchema,
  /** The model that answered, where the export says (`openai:gpt-4o`). */
  model: modelRefSchema.nullable(),
  /** The export's id of the parent; `null` for a root. */
  parentSourceId: z.string().min(1).nullable(),
  parts: z.array(messagePartSchema).min(1),
  role: messageRoleSchema,
  /** The export's id for this message, unique within the conversation. */
  sourceId: z.string().min(1),
  status: messageStatusSchema,
});
export type ImportedMessage = z.infer<typeof importedMessageSchema>;

/**
 * One conversation as a tree. `messages` lists parents before their children,
 * and no child is older than its parent (`checkTree`).
 */
export const importedConversationSchema = z.object({
  /** The leaf the user was last on (ChatGPT's `current_node`); `null`: the newest. */
  activeLeafSourceId: z.string().min(1).nullable(),
  createdAt: timestampSchema,
  messages: z.array(importedMessageSchema),
  source: importSourceSchema,
  /** The export's id for the conversation, for error reports. */
  sourceId: z.string().nullable(),
  title: z.string().max(TITLE_MAX).nullable(),
});
export type ImportedConversation = z.infer<typeof importedConversationSchema>;

// --- Data parts for what our parts can't hold directly ---

/**
 * An attachment the export mentions but doesn't carry. `file` parts need a
 * stored file or a fetchable URL, and exports have neither (ChatGPT asset
 * pointers and Claude attachments are references into the old service), so
 * the record is kept as a `data` part. Promoting one to a real `file` part
 * is for whoever can supply the bytes.
 */
export const IMPORTED_FILE = "imported-file";

export const importedFileDataSchema = z.object({
  /** Text the source extracted from the file (Claude's `extracted_content`). */
  extractedText: z.string().optional(),
  filename: z.string().max(512).optional(),
  height: z.int().min(0).optional(),
  mediaType: z.string().max(255).optional(),
  origin: importSourceSchema,
  /** The export's own reference: an asset pointer, file id or path. */
  ref: z.string().max(2048).optional(),
  sizeBytes: z.int().min(0).optional(),
  width: z.int().min(0).optional(),
});
export type ImportedFileData = z.infer<typeof importedFileDataSchema>;

/**
 * Export content with no counterpart in our parts (a ChatGPT content type we
 * don't map, a Claude block type added after this was written). Kept verbatim
 * rather than flattened into text, so nothing is lost and a later reader can
 * map it properly.
 */
export const IMPORTED_CONTENT = "imported-content";

export const importedContentDataSchema = z.object({
  content: jsonValueSchema,
  /** The source's type name: a ChatGPT `content_type`, a Claude block `type`. */
  kind: z.string().max(128),
  origin: importSourceSchema,
});
export type ImportedContentData = z.infer<typeof importedContentDataSchema>;

// --- Errors ---

/** Why one conversation in an export wasn't imported. The rest carry on. */
export const conversationFailureReasonSchema = z.enum([
  /** Not valid JSON. */
  "invalid_json",
  /** Not a conversation of any format we read. */
  "unknown_format",
  /** Valid JSON of the right format, but fields we need are missing or mistyped. */
  "invalid_shape",
  /** Over `IMPORT_LIMITS`. */
  "too_large",
  /** No messages left once hidden and empty ones are passed over. */
  "empty",
  /** A parent that's missing or out of order, or a duplicate id. */
  "invalid_tree",
]);
export type ConversationFailureReason = z.infer<
  typeof conversationFailureReasonSchema
>;

export const conversationFailureSchema = z.object({
  /** Detail for logs and the import report; paths and counts, never user content. */
  detail: z.string().optional(),
  /** Position in the export, from 0. */
  index: z.int().min(0),
  reason: conversationFailureReasonSchema,
  sourceId: z.string().nullable(),
});
export type ConversationFailure = z.infer<typeof conversationFailureSchema>;

/** A short, content-free summary of a zod failure: where, not what. */
export const describeIssues = (error: z.ZodError, max = 3): string =>
  error.issues
    .slice(0, max)
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.code}`)
    .join("; ");
