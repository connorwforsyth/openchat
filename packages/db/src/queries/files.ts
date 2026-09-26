import type {
  ConversationId,
  FileChunkId,
  FileId,
  UserId,
} from "@workspace/contract/schemas/common";
import type {
  FilePurpose,
  FileRecord,
  FileSearchHit,
} from "@workspace/contract/schemas/files";
import type { ModelRef } from "@workspace/contract/schemas/models";
import { type AsyncResult, err, ok } from "@workspace/shared/result";
import { and, asc, eq, inArray, type SQL, sql } from "drizzle-orm";

import type { Db } from "../client";
import { type NotFoundError, notFound } from "../errors";
import {
  type FileState,
  file,
  fileChunk,
  INDEXED_EMBEDDINGS,
  type STORAGE_DRIVERS,
} from "../schema/files";
import { rowsOf } from "./page";

// Files and RAG chunks (PLAN.md §8 RAG). The ingestion job writes chunks
// with their embeddings; `searchChunks` is the `file_search` tool's read.

export type FileRow = typeof file.$inferSelect;
export type FileChunkRow = typeof fileChunk.$inferSelect;

export interface NewFile {
  readonly conversationId?: ConversationId | null;
  readonly mediaType: string;
  readonly name: string;
  readonly ownerId: UserId;
  readonly purpose: FilePurpose;
  readonly sha256?: string | null;
  readonly size: number;
  readonly storageDriver: (typeof STORAGE_DRIVERS)[number];
  readonly storageKey: string;
}

export const createFile = async (db: Db, input: NewFile): Promise<FileRow> => {
  const [row] = await db
    .insert(file)
    .values({
      conversationId: input.conversationId ?? null,
      mediaType: input.mediaType,
      name: input.name,
      ownerId: input.ownerId,
      purpose: input.purpose,
      sha256: input.sha256 ?? null,
      size: input.size,
      storageDriver: input.storageDriver,
      storageKey: input.storageKey,
    })
    .returning();
  if (!row) {
    throw new Error("insert returned no row");
  }
  return row;
};

export const getFile = async (
  db: Db,
  id: FileId
): AsyncResult<FileRow, NotFoundError> => {
  const [row] = await db.select().from(file).where(eq(file.id, id));
  return row ? ok(row) : err(notFound("file", id));
};

/** Ingestion progress. `message` is kept only for `failed`. */
export const setFileState = async (
  db: Db,
  id: FileId,
  state: Exclude<FileState, "ready">,
  message?: string
): AsyncResult<FileRow, NotFoundError> => {
  const [row] = await db
    .update(file)
    .set({ state, stateMessage: state === "failed" ? (message ?? null) : null })
    .where(eq(file.id, id))
    .returning();
  return row ? ok(row) : err(notFound("file", id));
};

export interface NewChunk {
  /** `null` when the file isn't embedded (no embedding model configured). */
  readonly embedding: readonly number[] | null;
  readonly page?: number | null;
  readonly text: string;
  readonly tokenCount?: number | null;
}

/**
 * Replaces a file's chunks and marks it `ready`, in one transaction, so a
 * re-index (the embedding model changed) never leaves a half-indexed file.
 * Every embedding must come from `embeddingModel`.
 */
export const replaceChunks = (
  db: Db,
  fileId: FileId,
  chunks: readonly NewChunk[],
  embeddingModel: ModelRef | null
): AsyncResult<FileRow, NotFoundError> =>
  db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ id: file.id })
      .from(file)
      .where(eq(file.id, fileId))
      .for("update");
    if (!locked) {
      return err(notFound("file", fileId));
    }
    await tx.delete(fileChunk).where(eq(fileChunk.fileId, fileId));
    if (chunks.length > 0) {
      await tx.insert(fileChunk).values(
        chunks.map((chunk, ordinal) => ({
          dimensions: chunk.embedding ? chunk.embedding.length : null,
          embedding: chunk.embedding ? [...chunk.embedding] : null,
          embeddingModel: chunk.embedding ? embeddingModel : null,
          fileId,
          ordinal,
          page: chunk.page ?? null,
          text: chunk.text,
          tokenCount: chunk.tokenCount ?? null,
        }))
      );
    }
    const embedded = chunks.some((chunk) => chunk.embedding !== null);
    const [row] = await tx
      .update(file)
      .set({
        chunkCount: chunks.length,
        embeddingModel: embedded ? embeddingModel : null,
        state: "ready",
        stateMessage: null,
      })
      .where(eq(file.id, fileId))
      .returning();
    return row ? ok(row) : err(notFound("file", fileId));
  });

export const listChunks = (db: Db, fileId: FileId): Promise<FileChunkRow[]> =>
  db
    .select()
    .from(fileChunk)
    .where(eq(fileChunk.fileId, fileId))
    .orderBy(asc(fileChunk.ordinal));

/** Files embedded with a model other than `model`: what a re-index job must redo. */
export const listFilesToReindex = async (
  db: Db,
  model: ModelRef,
  limit = 100
): Promise<FileId[]> => {
  const rows = await db
    .select({ id: file.id })
    .from(file)
    .where(
      and(
        eq(file.state, "ready"),
        sql`${file.embeddingModel} is distinct from ${model}`,
        inArray(file.purpose, ["knowledge", "attachment"])
      )
    )
    .limit(limit);
  return rows.map((row) => row.id);
};

export interface ChunkSearch {
  readonly embedding: readonly number[];
  /** Only files the caller may read; the caller resolves access. Empty finds nothing. */
  readonly fileIds: readonly FileId[];
  readonly limit: number;
  /** Only vectors from this model are comparable. */
  readonly model: ModelRef;
}

/** The cast that lets Postgres use the partial HNSW index for this size, if there is one. */
const embeddingExpression = (dimensions: number): SQL => {
  const indexed = INDEXED_EMBEDDINGS.find(
    (entry) => entry.dimensions === dimensions
  );
  return indexed
    ? sql.raw(`"file_chunk"."embedding"::${indexed.type}(${dimensions})`)
    : sql.raw(`"file_chunk"."embedding"`);
};

const queryVector = (embedding: readonly number[]): SQL => {
  const dimensions = embedding.length;
  const type =
    INDEXED_EMBEDDINGS.find((entry) => entry.dimensions === dimensions)?.type ??
    "vector";
  return sql`${`[${embedding.join(",")}]`}::${sql.raw(`${type}(${dimensions})`)}`;
};

/**
 * Nearest chunks by cosine distance among `fileIds`, closest first. The score
 * is cosine similarity clamped to [0, 1]. Filtering on `dimensions` both
 * keeps mismatched vectors out and lets the planner pick the partial index;
 * it's inlined (an integer, from the array's length) because a partial index
 * only matches a predicate the planner can see.
 */
export const searchChunks = async (
  db: Db,
  input: ChunkSearch
): Promise<FileSearchHit[]> => {
  if (input.fileIds.length === 0 || input.embedding.length === 0) {
    return [];
  }
  const dimensions = input.embedding.length;
  const distance = sql`${embeddingExpression(dimensions)} <=> ${queryVector(input.embedding)}`;
  const rows = rowsOf<{
    chunk_id: FileChunkId;
    distance: number | string;
    file_id: FileId;
    filename: string;
    page: number | null;
    text: string;
  }>(
    await db.execute(sql`
      select ${fileChunk.id} as chunk_id, ${fileChunk.fileId} as file_id, ${file.name} as filename,
        ${fileChunk.page} as page, ${fileChunk.text} as text, ${distance} as distance
      from ${fileChunk} join ${file} on ${file.id} = ${fileChunk.fileId}
      where ${fileChunk.dimensions} = ${sql.raw(String(dimensions))}
        and ${fileChunk.embeddingModel} = ${input.model}
        and ${inArray(fileChunk.fileId, [...input.fileIds])}
      order by ${distance}
      limit ${input.limit}
    `)
  );
  return rows.map((row) => ({
    chunkId: row.chunk_id,
    fileId: row.file_id,
    filename: row.filename,
    page: row.page,
    score: Math.min(1, Math.max(0, 1 - Number(row.distance))),
    text: row.text,
  }));
};

/** A row as the contract's `FileRecord`. */
export const toFileRecord = (row: FileRow): FileRecord => {
  const base = {
    conversationId: row.conversationId,
    createdAt: row.createdAt.toISOString(),
    id: row.id,
    mediaType: row.mediaType,
    name: row.name,
    ownerId: row.ownerId,
    purpose: row.purpose,
    size: row.size,
  };
  switch (row.state) {
    case "ready":
      return {
        ...base,
        status: {
          chunkCount: row.chunkCount ?? 0,
          embeddingModel: row.embeddingModel,
          state: "ready",
        },
      };
    case "failed":
      return {
        ...base,
        status: { message: row.stateMessage ?? "", state: "failed" },
      };
    case "uploaded":
    case "processing":
      return { ...base, status: { state: row.state } };
    default:
      return row.state satisfies never;
  }
};
