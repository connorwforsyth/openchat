import {
  libraryItemIdSchema,
  userIdSchema,
} from "@workspace/contract/schemas/common";
import {
  libraryItemSchema,
  promptDefinitionSchema,
} from "@workspace/contract/schemas/library";
import { chatContextSchema } from "@workspace/contract/schemas/tenancy";
import { z } from "zod";

// The composer's own shapes. Everything it receives is a contract type (or a
// pick of one) so a caller can pass what the API returns without mapping;
// everything it emits is described here, so a consumer can parse it too.

/** Where the current run is. Mirrors the AI SDK's `ChatStatus`. */
export const composerStatusSchema = z.enum([
  "ready",
  "submitted",
  "streaming",
  "error",
]);
export type ComposerStatus = z.infer<typeof composerStatusSchema>;

/**
 * Where an agent the caller can use comes from (D13's library tabs): their
 * own, shared with them, or a team or org library.
 */
export const agentSourceSchema = z.enum(["mine", "shared", "libraries"]);
export type AgentSource = z.infer<typeof agentSourceSchema>;

/** An agent the composer can target or mention: the listing fields of a library item. */
export const agentOptionSchema = libraryItemSchema
  .pick({
    description: true,
    icon: true,
    id: true,
    name: true,
  })
  .extend({
    /** Groups the picker; left out, the agent is listed under "Agents". */
    source: agentSourceSchema.optional(),
  });
export type AgentOption = z.infer<typeof agentOptionSchema>;

/** A prompt template offered from `/`: a library item with its prompt definition. */
export const promptOptionSchema = libraryItemSchema
  .pick({ description: true, id: true, name: true })
  .extend({ definition: promptDefinitionSchema });
export type PromptOption = z.infer<typeof promptOptionSchema>;

/**
 * A chat context the chip offers. `name` labels teams and orgs; Personal is
 * labelled by the composer so it's translated.
 */
export const contextOptionSchema = z.object({
  context: chatContextSchema,
  name: z.string().optional(),
});
export type ContextOption = z.infer<typeof contextOptionSchema>;

/** Something `@` can mention. */
export const mentionCandidateSchema = z.discriminatedUnion("kind", [
  z.object({
    description: z.string().optional(),
    id: libraryItemIdSchema,
    kind: z.literal("agent"),
    label: z.string().min(1),
  }),
  z.object({
    description: z.string().optional(),
    id: userIdSchema,
    kind: z.literal("user"),
    label: z.string().min(1),
  }),
]);
export type MentionCandidate = z.infer<typeof mentionCandidateSchema>;

/**
 * A mention as it sits in the submitted text: `text.slice(start, end)` is
 * `@label`.
 */
export const mentionTokenSchema = z.discriminatedUnion("kind", [
  mentionCandidateSchema.options[0]
    .omit({ description: true })
    .extend({ end: z.int().min(1), start: z.int().min(0) }),
  mentionCandidateSchema.options[1]
    .omit({ description: true })
    .extend({ end: z.int().min(1), start: z.int().min(0) }),
]);
export type MentionToken = z.infer<typeof mentionTokenSchema>;

// `File` exists in browsers and in Node 20+, but a guard keeps this module
// importable anywhere (a Server Component may import the schemas).
const fileSchema = z.custom<File>(
  (value) => typeof File !== "undefined" && value instanceof File,
  "a File"
);

export const composerAttachmentSchema = z.object({
  file: fileSchema,
  /** Stable for this composer's lifetime; keys the chip and `remove`. */
  id: z.string().min(1),
});
export type ComposerAttachment = z.infer<typeof composerAttachmentSchema>;

/** Limits on what may be attached. Omitted means unlimited. */
export const attachmentLimitsSchema = z.object({
  /** MIME types (`application/pdf`), wildcards (`image/*`) or extensions (`.md`). */
  accept: z.array(z.string().min(1)).optional(),
  /** Bytes per file. */
  maxFileSize: z.int().min(1).optional(),
  maxFiles: z.int().min(0).optional(),
});
export type AttachmentLimits = z.infer<typeof attachmentLimitsSchema>;

/** Why a file wasn't attached. */
export const attachmentRejectionSchema = z.discriminatedUnion("code", [
  z.object({ code: z.literal("type"), fileName: z.string() }),
  z.object({
    code: z.literal("size"),
    fileName: z.string(),
    maxFileSize: z.int().min(1),
  }),
  z.object({
    code: z.literal("count"),
    fileName: z.string(),
    maxFiles: z.int().min(0),
  }),
]);
export type AttachmentRejection = z.infer<typeof attachmentRejectionSchema>;

/** What the composer submits. */
export const composerValueSchema = z.object({
  attachments: z.array(composerAttachmentSchema),
  /** In text order, non-overlapping. */
  mentions: z.array(mentionTokenSchema),
  /** The prompt template the text started from, if any. */
  templateId: libraryItemIdSchema.nullable(),
  /** Trimmed. May be empty when there are attachments. */
  text: z.string(),
});
export type ComposerValue = z.infer<typeof composerValueSchema>;
