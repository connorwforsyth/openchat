import {
  type FilePurpose,
  filePurposeSchema,
} from "@workspace/contract/schemas/files";
import {
  type ArtifactKind,
  artifactKindSchema,
} from "@workspace/contract/schemas/message-parts";
import type { ModelRef } from "@workspace/contract/schemas/models";
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { conversation, message } from "./chat";
import {
  createdAt,
  idColumn,
  idRef,
  oneOf,
  updatedAt,
  vector,
} from "./columns";
import { skillVersion } from "./library";

// Files, RAG chunks and artifacts (PLAN.md §8 RAG).

export const FILE_STATES = [
  "uploaded",
  "processing",
  "ready",
  "failed",
] as const;
export type FileState = (typeof FILE_STATES)[number];

export const STORAGE_DRIVERS = ["local", "s3"] as const;

/**
 * Embedding sizes with an HNSW index. The column has no fixed dimension
 * (the model is configurable), and pgvector can only index a fixed one, so
 * each size gets a partial index over a cast (pgvector's documented pattern).
 * `vector` indexes stop at 2,000 dimensions, so larger models index as
 * `halfvec`. Other sizes still search correctly, just without an index; add
 * a size here (and generate a migration) when a new model needs one.
 */
export const INDEXED_EMBEDDINGS = [
  { dimensions: 384, type: "vector" },
  { dimensions: 768, type: "vector" },
  { dimensions: 1024, type: "vector" },
  { dimensions: 1536, type: "vector" },
  { dimensions: 3072, type: "halfvec" },
] as const;

export const file = pgTable(
  "file",
  {
    /** Set when ingestion finishes. */
    chunkCount: integer("chunk_count"),
    /** Set for chat attachments. */
    conversationId: idRef("conversation_id", "conversation").references(
      () => conversation.id,
      { onDelete: "set null" }
    ),
    createdAt: createdAt(),
    /** The model the chunks were embedded with; `null` when not indexed. */
    embeddingModel: text("embedding_model").$type<ModelRef>(),
    id: idColumn("file"),
    mediaType: text("media_type").notNull(),
    name: text("name").notNull(),
    ownerId: idRef("owner_id", "user")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    purpose: text("purpose").$type<FilePurpose>().notNull(),
    /** Hex SHA-256 of the bytes, to skip re-embedding identical uploads. */
    sha256: text("sha256"),
    size: bigint("size", { mode: "number" }).notNull(),
    state: text("state").$type<FileState>().notNull().default("uploaded"),
    /** Why ingestion failed; safe to show. */
    stateMessage: text("state_message"),
    storageDriver: text("storage_driver")
      .$type<(typeof STORAGE_DRIVERS)[number]>()
      .notNull(),
    /** The object's key in its storage driver. */
    storageKey: text("storage_key").notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("file_owner_idx").on(t.ownerId, t.createdAt),
    index("file_conversation_idx").on(t.conversationId),
    uniqueIndex("file_storage_key_uidx").on(t.storageDriver, t.storageKey),
    check("file_purpose", oneOf(t.purpose, filePurposeSchema.options)),
    check("file_state", oneOf(t.state, FILE_STATES)),
    check("file_storage_driver", oneOf(t.storageDriver, STORAGE_DRIVERS)),
    check("file_size_non_negative", sql`${t.size} >= 0`),
  ]
);

/**
 * A chunk of a file's text and its embedding. Every vector records the model
 * and dimension it came from: changing `embeddings.model` re-indexes, and
 * searches only compare vectors from the same model.
 */
export const fileChunk = pgTable(
  "file_chunk",
  {
    createdAt: createdAt(),
    /** `vector_dims(embedding)`, stored so it can drive the partial indexes. */
    dimensions: integer("dimensions"),
    embedding: vector("embedding"),
    embeddingModel: text("embedding_model").$type<ModelRef>(),
    fileId: idRef("file_id", "file")
      .notNull()
      .references(() => file.id, { onDelete: "cascade" }),
    id: idColumn("fileChunk"),
    /** Position in the file, from 0. */
    ordinal: integer("ordinal").notNull(),
    /** 1-based page for paged formats (PDF), else `null`. */
    page: integer("page"),
    text: text("text").notNull(),
    tokenCount: integer("token_count"),
  },
  (t) => [
    uniqueIndex("file_chunk_file_ordinal_uidx").on(t.fileId, t.ordinal),
    index("file_chunk_model_idx").on(t.embeddingModel, t.dimensions),
    check(
      "file_chunk_embedding_recorded",
      sql`(${t.embedding} is null and ${t.embeddingModel} is null and ${t.dimensions} is null) or (${t.embedding} is not null and ${t.embeddingModel} is not null and ${t.dimensions} = vector_dims(${t.embedding}))`
    ),
    ...INDEXED_EMBEDDINGS.map(({ dimensions, type }) =>
      index(`file_chunk_embedding_${dimensions}_idx`)
        .using(
          "hnsw",
          sql.raw(`("embedding"::${type}(${dimensions})) ${type}_cosine_ops`)
        )
        .where(sql.raw(`"dimensions" = ${dimensions}`))
    ),
  ]
);

/** A file bundled with a skill version (scripts, resources). */
export const skillFile = pgTable(
  "skill_file",
  {
    fileId: idRef("file_id", "file")
      .notNull()
      .references(() => file.id),
    /** Relative to the skill root. */
    path: text("path").notNull(),
    skillVersionId: idRef("skill_version_id", "libraryVersion")
      .notNull()
      .references(() => skillVersion.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.skillVersionId, t.path] })]
);

export const artifact = pgTable(
  "artifact",
  {
    conversationId: idRef("conversation_id", "conversation")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    id: idColumn("artifact"),
    kind: text("kind").$type<ArtifactKind>().notNull(),
    latestVersionId: idRef("latest_version_id", "artifactVersion").references(
      (): AnyPgColumn => artifactVersion.id,
      { onDelete: "set null" }
    ),
    /** The message that created it. */
    messageId: idRef("message_id", "message")
      .notNull()
      .references(() => message.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("artifact_conversation_idx").on(t.conversationId),
    check("artifact_kind", oneOf(t.kind, artifactKindSchema.options)),
  ]
);

export const artifactVersion = pgTable(
  "artifact_version",
  {
    artifactId: idRef("artifact_id", "artifact")
      .notNull()
      .references(() => artifact.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    createdAt: createdAt(),
    id: idColumn("artifactVersion"),
    /** For `code` artifacts: a Shiki language id. */
    language: text("language"),
    /** The message that produced this version. */
    messageId: idRef("message_id", "message")
      .notNull()
      .references(() => message.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
  },
  (t) => [
    uniqueIndex("artifact_version_number_uidx").on(t.artifactId, t.number),
    check("artifact_version_number_positive", sql`${t.number} >= 1`),
  ]
);
