import { z } from "zod";

import {
  annotationIdSchema,
  artifactIdSchema,
  artifactVersionIdSchema,
  fileChunkIdSchema,
  fileIdSchema,
  jsonValueSchema,
  providerMetadataSchema,
  timestampSchema,
  userIdSchema,
} from "./common";

// Messages are stored in our own versioned `MessagePart` schema, not the AI
// SDK's `UIMessage` (PLAN.md Q4). The AI SDK UI message stream is the wire
// format while a run streams; the run executor maps the finished stream into
// these parts, and `partsVersion` lets a later reader migrate old rows.
//
// Differences from the AI SDK's parts, on purpose:
// - tool calls and results are separate parts, joined by `toolCallId`, so a
//   result can arrive in a later message (after an approval) without
//   rewriting the call;
// - approval state, including per-hunk review, lives on the call;
// - files and sources point at our `file` rows, not only URLs;
// - artifacts and annotations are references, not inline content.

/** Bump when a part's shape changes incompatibly, and write a migration for stored rows. */
export const PARTS_VERSION = 1;
export const partsVersionSchema = z.literal(PARTS_VERSION);

/** `data-*` part names: kebab-case, so they map to AI SDK `data-<name>` parts. */
const DATA_PART_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export const textPartSchema = z.object({
  providerMetadata: providerMetadataSchema.optional(),
  text: z.string(),
  type: z.literal("text"),
});

export const reasoningPartSchema = z.object({
  /** Carries signatures some providers need to replay reasoning. */
  providerMetadata: providerMetadataSchema.optional(),
  text: z.string(),
  type: z.literal("reasoning"),
});

/** Where a file's bytes live: an uploaded `file` row, or an external URL. */
export const fileSourceSchema = z.discriminatedUnion("kind", [
  z.object({ fileId: fileIdSchema, kind: z.literal("file") }),
  z.object({ kind: z.literal("url"), url: z.url() }),
]);

export const filePartSchema = z.object({
  filename: z.string().max(512).optional(),
  mediaType: z.string().min(1).max(255),
  providerMetadata: providerMetadataSchema.optional(),
  source: fileSourceSchema,
  type: z.literal("file"),
});

/** A citation: a web page, or a chunk of an uploaded file (RAG). */
export const citationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("url"),
    title: z.string().optional(),
    url: z.url(),
  }),
  z.object({
    chunkId: fileChunkIdSchema.optional(),
    fileId: fileIdSchema,
    filename: z.string().optional(),
    kind: z.literal("file"),
    page: z.int().min(1).optional(),
    title: z.string().optional(),
  }),
]);

export const sourcePartSchema = z.object({
  /** Stable within the message, so text can reference it. */
  id: z.string().min(1).max(128),
  providerMetadata: providerMetadataSchema.optional(),
  source: citationSchema,
  type: z.literal("source"),
});

/** The reviewer's call on one hunk of a proposed edit (D16 per-hunk review). */
export const hunkDecisionSchema = z.object({
  comment: z.string().max(4000).optional(),
  decision: z.enum(["accept", "reject"]),
  /** Stable id of the hunk, from the patch the tool call proposed. */
  hunkId: z.string().min(1).max(128),
});
export type HunkDecision = z.infer<typeof hunkDecisionSchema>;

/** A comment on a line of a proposed edit, sent back to the agent with the result. */
export const lineCommentSchema = z.object({
  line: z.int().min(1),
  path: z.string().min(1),
  text: z.string().min(1).max(4000),
});

/**
 * What an approver decided. `review` is the per-hunk form for write/edit tools:
 * only accepted hunks are applied, and rejections (with comments) become the
 * tool result the agent sees.
 */
export const approvalDecisionSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("approve") }),
  z.object({
    decision: z.literal("reject"),
    reason: z.string().max(4000).optional(),
  }),
  z.object({
    comments: z.array(lineCommentSchema).max(200).default([]),
    decision: z.literal("review"),
    hunks: z.array(hunkDecisionSchema).min(1).max(1000),
  }),
]);
export type ApprovalDecision = z.infer<typeof approvalDecisionSchema>;

/** A tool call's approval lifecycle. */
export const approvalStateSchema = z.discriminatedUnion("state", [
  /** The tool runs without asking (policy or permission mode allowed it). */
  z.object({ state: z.literal("not-required") }),
  z.object({ requestedAt: timestampSchema, state: z.literal("pending") }),
  z.object({
    decidedAt: timestampSchema,
    decidedBy: userIdSchema,
    decision: approvalDecisionSchema,
    state: z.literal("decided"),
  }),
]);
export type ApprovalState = z.infer<typeof approvalStateSchema>;

export const toolNameSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9_.:-]+$/, "letters, digits, `_`, `.`, `:` and `-`");

export const toolCallPartSchema = z.object({
  approval: approvalStateSchema,
  input: jsonValueSchema,
  /** Executed by the provider (native web search), not by us. */
  providerExecuted: z.boolean().optional(),
  providerMetadata: providerMetadataSchema.optional(),
  /** Provider-issued; unique within the conversation. */
  toolCallId: z.string().min(1).max(256),
  toolName: toolNameSchema,
  type: z.literal("tool-call"),
});

export const toolOutputSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("success"), value: jsonValueSchema }),
  z.object({ message: z.string(), status: z.literal("error") }),
  /** The approver rejected the call; the agent sees the reason and any hunk decisions. */
  z.object({
    decision: approvalDecisionSchema,
    status: z.literal("denied"),
  }),
]);
export type ToolOutput = z.infer<typeof toolOutputSchema>;

export const toolResultPartSchema = z.object({
  output: toolOutputSchema,
  providerMetadata: providerMetadataSchema.optional(),
  toolCallId: z.string().min(1).max(256),
  toolName: toolNameSchema,
  type: z.literal("tool-result"),
});

export const artifactKindSchema = z.enum([
  "code",
  "html",
  "react",
  "markdown",
  "svg",
  "mermaid",
  /** A small static website: several files, published to a link (125). */
  "site",
  /** Rich text (126): a TipTap (ProseMirror) document as JSON. */
  "document",
  /**
   * A picture `generate_image` made (138): a version is one image as a
   * `data:` URL, so the Artifacts page shows it without the chat's workspace.
   */
  "image",
  /** Slides (164): TSX pages on a fixed 1920×1080 canvas, as JSON. */
  "presentation",
  /** Sheets of cells and formulas (166), as JSON. */
  "spreadsheet",
  /** A graph of nodes and edges people can edit (165), as JSON. */
  "diagram",
]);
export type ArtifactKind = z.infer<typeof artifactKindSchema>;

export const artifactRefPartSchema = z.object({
  artifactId: artifactIdSchema,
  kind: artifactKindSchema,
  title: z.string().max(200),
  type: z.literal("artifact-ref"),
  versionId: artifactVersionIdSchema,
});

/** Placeholder for the Annotate wave: pins sent to the agent with a turn. */
export const annotationRefPartSchema = z.object({
  annotationId: annotationIdSchema,
  type: z.literal("annotation-ref"),
});

/**
 * Typed app data that isn't prose (for example `memory-update`). Maps to the
 * AI SDK's `data-<name>` parts. Each name's `data` schema is owned by the
 * feature that emits it.
 */
export const dataPartSchema = z.object({
  data: jsonValueSchema,
  id: z.string().max(128).optional(),
  name: z.string().regex(DATA_PART_NAME, "kebab-case name").max(64),
  type: z.literal("data"),
});

/** A step boundary in a multi-step agent turn (AI SDK `step-start`), for rendering. */
export const stepStartPartSchema = z.object({ type: z.literal("step-start") });

export const messagePartSchema = z.discriminatedUnion("type", [
  textPartSchema,
  reasoningPartSchema,
  filePartSchema,
  sourcePartSchema,
  toolCallPartSchema,
  toolResultPartSchema,
  artifactRefPartSchema,
  annotationRefPartSchema,
  dataPartSchema,
  stepStartPartSchema,
]);
export type MessagePart = z.infer<typeof messagePartSchema>;
export type MessagePartType = MessagePart["type"];

/** Parts a user may send. Everything else is produced by runs. */
export const userMessagePartSchema = z.discriminatedUnion("type", [
  textPartSchema,
  filePartSchema,
  annotationRefPartSchema,
  dataPartSchema,
]);
export type UserMessagePart = z.infer<typeof userMessagePartSchema>;
