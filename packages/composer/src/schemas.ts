import { placedChipSchema } from "@workspace/ai/messages/chips";
import {
  libraryItemIdSchema,
  libraryVersionIdSchema,
  userIdSchema,
} from "@workspace/contract/schemas/common";
import {
  libraryItemSchema,
  promptDefinitionSchema,
} from "@workspace/contract/schemas/library";
import { artifactKindSchema } from "@workspace/contract/schemas/message-parts";
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

/**
 * The caller's own unpublished draft of a library item, by its draft
 * version: only its owner is offered it, labelled Draft, and a pick runs
 * that version. Left out for published items, which the team shares.
 */
const draftFields = {
  draftVersion: libraryVersionIdSchema.optional(),
};

/** An agent the composer can target or mention: the listing fields of a library item. */
export const agentOptionSchema = libraryItemSchema
  .pick({
    description: true,
    icon: true,
    id: true,
    name: true,
  })
  .extend({
    ...draftFields,
    /** Groups the picker; left out, the agent is listed under "Agents". */
    source: agentSourceSchema.optional(),
  });
export type AgentOption = z.infer<typeof agentOptionSchema>;

/** A prompt template offered from `/`: a library item with its prompt definition. */
export const promptOptionSchema = libraryItemSchema
  .pick({ description: true, id: true, name: true })
  .extend({ definition: promptDefinitionSchema, ...draftFields });
export type PromptOption = z.infer<typeof promptOptionSchema>;

/**
 * A skill the composer offers (127): the listing fields of a library item.
 * Picked from the + menu or `/`, it rides with the next message as a chip,
 * and the host sends it as the run's `input.skills`.
 */
export const skillOptionSchema = libraryItemSchema
  .pick({ description: true, id: true, name: true })
  .extend({
    ...draftFields,
    /** Where it comes from, as for agents; left out, it isn't grouped. */
    source: agentSourceSchema.optional(),
  });
export type SkillOption = z.infer<typeof skillOptionSchema>;

/**
 * A skill on the message being written: what the host sends as the run's
 * `input.skills`, pinned to the owner's draft when it is one.
 */
export const pickedSkillOptionSchema = z.object({
  id: libraryItemIdSchema,
  name: z.string().min(1),
  versionId: libraryVersionIdSchema.optional(),
});
export type PickedSkillOption = z.infer<typeof pickedSkillOptionSchema>;

/**
 * A chat context the chip offers. `name` labels teams and orgs; Personal is
 * labelled by the composer so it's translated.
 */
export const contextOptionSchema = z.object({
  context: chatContextSchema,
  name: z.string().optional(),
});
export type ContextOption = z.infer<typeof contextOptionSchema>;

/**
 * An artifact type the menu offers (`@Slides`): picked, the message asks
 * for that kind. The host names it, translated.
 */
export const artifactOptionSchema = z.object({
  kind: artifactKindSchema,
  label: z.string().min(1),
});
export type ArtifactOption = z.infer<typeof artifactOptionSchema>;

/**
 * Chat or Code, the conversation's mode: in Chat, the menu leaves out what
 * only Code can do. Left out, everything is offered.
 */
export const composerModeSchema = z.enum(["chat", "code"]);
export type ComposerMode = z.infer<typeof composerModeSchema>;

/**
 * A file in the chat's workspace, relative to its root (`src/app.ts`). The
 * host lists them; the composer only offers and echoes them back.
 */
export const workspacePathSchema = z.string().min(1);
export type WorkspacePath = z.infer<typeof workspacePathSchema>;

/**
 * File actions `/` offers ahead of prompts. The composer only reports the
 * choice (`onCommand`); what a command does is the host's.
 */
export const composerCommandSchema = z.enum(["new-file", "open", "preview"]);
export type ComposerCommand = z.infer<typeof composerCommandSchema>;

/** A person `@` can mention, or a workspace file. */
export const mentionCandidateSchema = z.discriminatedUnion("kind", [
  z.object({
    description: z.string().optional(),
    id: userIdSchema,
    kind: z.literal("user"),
    label: z.string().min(1),
  }),
  z.object({
    /** The folder, as a hint beside the name. */
    description: z.string().optional(),
    kind: z.literal("file"),
    /** The file name; `path` says which one. */
    label: z.string().min(1),
    path: workspacePathSchema,
  }),
]);
export type MentionCandidate = z.infer<typeof mentionCandidateSchema>;
export type FileCandidate = Extract<MentionCandidate, { kind: "file" }>;

/**
 * A chip as it sits in the submitted text: `text.slice(start, end)` is
 * `@label`. The same shape the message carries (`data-chips`).
 */
export const mentionTokenSchema = placedChipSchema;
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
  /** The chips in the text, in text order, non-overlapping. */
  mentions: z.array(mentionTokenSchema),
  /** The skill chips (127), once each, in text order. */
  skills: z.array(pickedSkillOptionSchema),
  /** The prompt template the text started from, if any. */
  templateId: libraryItemIdSchema.nullable(),
  /** Trimmed. May be empty when there are attachments. */
  text: z.string(),
});
export type ComposerValue = z.infer<typeof composerValueSchema>;
