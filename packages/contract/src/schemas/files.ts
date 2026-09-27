import { z } from "zod";

import {
  artifactIdSchema,
  artifactVersionIdSchema,
  conversationIdSchema,
  fileChunkIdSchema,
  fileIdSchema,
  messageIdSchema,
  pageInputSchema,
  timestampSchema,
  userIdSchema,
} from "./common";
import { artifactKindSchema } from "./message-parts";
import { modelRefSchema } from "./models";

// Files, RAG and artifacts (PLAN.md §8 RAG). Uploads land in storage (local
// volume or S3-compatible), then a pg-boss job parses, chunks and embeds them.

/** Why a file was uploaded; it decides whether it's indexed for `file_search`. */
export const filePurposeSchema = z.enum(["attachment", "knowledge", "skill"]);
export type FilePurpose = z.infer<typeof filePurposeSchema>;

/** Ingestion progress. Attachments that aren't indexed go straight to `ready`. */
export const fileStatusSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("uploaded") }),
  z.object({ state: z.literal("processing") }),
  z.object({
    chunkCount: z.int().min(0),
    /** `null` when the file isn't indexed (no embedding model, or not text). */
    embeddingModel: modelRefSchema.nullable(),
    state: z.literal("ready"),
  }),
  z.object({ message: z.string(), state: z.literal("failed") }),
]);
export type FileStatus = z.infer<typeof fileStatusSchema>;

export const fileSchema = z.object({
  /** Set for chat attachments. */
  conversationId: conversationIdSchema.nullable(),
  createdAt: timestampSchema,
  id: fileIdSchema,
  mediaType: z.string().min(1).max(255),
  name: z.string().min(1).max(512),
  ownerId: userIdSchema,
  purpose: filePurposeSchema,
  size: z.int().min(0),
  status: fileStatusSchema,
});
export type FileRecord = z.infer<typeof fileSchema>;

/** Multipart upload. The size cap comes from `limits.uploadMaxMb` in app.config.yaml. */
export const uploadFileInputSchema = z.object({
  conversationId: conversationIdSchema.optional(),
  file: z.file(),
  purpose: filePurposeSchema.default("attachment"),
});

export const listFilesInputSchema = pageInputSchema.extend({
  conversationId: conversationIdSchema.optional(),
  purpose: filePurposeSchema.optional(),
});

/** A short-lived signed URL; never a permanent public one. */
export const fileUrlSchema = z.object({
  expiresAt: timestampSchema,
  url: z.url(),
});

export const fileSearchInputSchema = z.object({
  /** Limit to these files; omitted means every indexed file the caller can read. */
  fileIds: z.array(fileIdSchema).max(500).optional(),
  limit: z.int().min(1).max(50).default(10),
  query: z.string().trim().min(1).max(2000),
});

export const fileSearchHitSchema = z.object({
  chunkId: fileChunkIdSchema,
  fileId: fileIdSchema,
  filename: z.string(),
  page: z.int().min(1).nullable(),
  /** Similarity in [0, 1], higher is closer. */
  score: z.number().min(0).max(1),
  text: z.string(),
});
export type FileSearchHit = z.infer<typeof fileSearchHitSchema>;

export const artifactSchema = z.object({
  conversationId: conversationIdSchema,
  createdAt: timestampSchema,
  id: artifactIdSchema,
  kind: artifactKindSchema,
  /** `null` until its first version is written (the row is created first). */
  latestVersionId: artifactVersionIdSchema.nullable(),
  /** The message that created it. */
  messageId: messageIdSchema,
  title: z.string().max(200),
  updatedAt: timestampSchema,
});
export type Artifact = z.infer<typeof artifactSchema>;

export const artifactVersionSchema = z.object({
  artifactId: artifactIdSchema,
  content: z.string(),
  createdAt: timestampSchema,
  id: artifactVersionIdSchema,
  /** For `code` artifacts: a Shiki language id. */
  language: z.string().max(64).nullable(),
  /** The message that produced this version. */
  messageId: messageIdSchema,
  number: z.int().min(1),
});
export type ArtifactVersion = z.infer<typeof artifactVersionSchema>;
