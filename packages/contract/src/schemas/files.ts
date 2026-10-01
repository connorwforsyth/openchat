import { z } from "zod";

import {
  artifactIdSchema,
  artifactVersionIdSchema,
  conversationIdSchema,
  fileChunkIdSchema,
  fileIdSchema,
  grantIdSchema,
  messageIdSchema,
  pageInputSchema,
  timestampSchema,
  userIdSchema,
} from "./common";
import { artifactKindSchema } from "./message-parts";
import { modelRefSchema } from "./models";
import { principalSchema } from "./tenancy";

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
  /**
   * Who owns it (124): the person whose chat made it. Sharing is the
   * owner's, through the artifact's own grants, not the chat's.
   */
  ownerId: userIdSchema,
  title: z.string().max(200),
  updatedAt: timestampSchema,
});
export type Artifact = z.infer<typeof artifactSchema>;

export const artifactVersionSchema = z.object({
  artifactId: artifactIdSchema,
  content: z.string(),
  /**
   * The chat that made this version (124). An artifact used in another chat
   * gets versions from there too, so this can differ from the artifact's.
   */
  conversationId: conversationIdSchema,
  createdAt: timestampSchema,
  id: artifactVersionIdSchema,
  /** For `code` artifacts: a Shiki language id. */
  language: z.string().max(64).nullable(),
  /** The message that produced this version. */
  messageId: messageIdSchema,
  number: z.int().min(1),
});
export type ArtifactVersion = z.infer<typeof artifactVersionSchema>;

// The Artifacts page (124): everything you made or that was shared with
// you, across chats. An artifact is owned by a person and shared like a
// chat, with `viewer` or `editor` grants to a user, team or org.

/** A grant's level on an artifact: see it, or also change it. */
export const artifactPermissionSchema = z.enum(["viewer", "editor"]);
export type ArtifactPermission = z.infer<typeof artifactPermissionSchema>;

/** The caller's own access: the owner's, or the strongest grant they hold. */
export const artifactAccessSchema = z.enum(["owner", "editor", "viewer"]);
export type ArtifactAccess = z.infer<typeof artifactAccessSchema>;

/** Who can see it besides the owner: no one yet, or someone it was shared with. */
export const artifactVisibilitySchema = z.enum(["private", "shared"]);
export type ArtifactVisibility = z.infer<typeof artifactVisibilitySchema>;

/** One row of the Artifacts page. */
export const artifactListItemSchema = artifactSchema.extend({
  access: artifactAccessSchema,
  /** Whether the caller can open the chat that made it ("Go to chat"). */
  canGoToChat: z.boolean(),
  ownerName: z.string(),
  /** When the caller last opened it; `null` if they never have. */
  viewedAt: timestampSchema.nullable(),
  visibility: artifactVisibilitySchema,
});
export type ArtifactListItem = z.infer<typeof artifactListItemSchema>;

/** `all`: yours and shared with you; `mine`: yours; `shared`: others' shared with you. */
export const artifactScopeSchema = z.enum(["all", "mine", "shared"]);
export type ArtifactScope = z.infer<typeof artifactScopeSchema>;

/** Sorted by when the caller last viewed each, then by its last change. */
export const listAllArtifactsInputSchema = pageInputSchema.extend({
  kind: artifactKindSchema.optional(),
  /** Matches the title and the latest version's content. */
  query: z.string().trim().max(200).optional(),
  scope: artifactScopeSchema.default("all"),
});
export type ListAllArtifactsInput = z.input<typeof listAllArtifactsInputSchema>;

/** The full-page view: the artifact and every version, oldest first. */
export const artifactDetailSchema = z.object({
  artifact: artifactListItemSchema,
  versions: z.array(artifactVersionSchema),
});
export type ArtifactDetail = z.infer<typeof artifactDetailSchema>;

export const renameArtifactInputSchema = z.object({
  id: artifactIdSchema,
  title: z.string().trim().min(1).max(200),
});

/** A share on one artifact. */
export const artifactGrantSchema = z.object({
  createdAt: timestampSchema,
  grantedBy: userIdSchema,
  id: grantIdSchema,
  permission: artifactPermissionSchema,
  principal: principalSchema,
});
export type ArtifactGrant = z.infer<typeof artifactGrantSchema>;

/** Re-sharing with the same principal replaces its level. */
export const shareArtifactInputSchema = z.object({
  id: artifactIdSchema,
  permission: artifactPermissionSchema,
  principal: principalSchema,
});

/**
 * "Use in chat": attaches the artifact to a chat by reference, so that
 * chat's model sees its latest version and can make new versions of it.
 */
export const useArtifactInputSchema = z.object({
  conversationId: conversationIdSchema,
  id: artifactIdSchema,
});
