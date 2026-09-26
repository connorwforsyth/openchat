import {
  type FileId,
  fileIdSchema,
  type JsonValue,
} from "@workspace/contract/schemas/common";
import type { FilePurpose } from "@workspace/contract/schemas/files";
import {
  type ModelRef,
  modelRefSchema,
} from "@workspace/contract/schemas/models";
import { type AsyncResult, err, ok } from "@workspace/shared/result";
import { z } from "zod";

import type { Embedder, EmbedderError } from "../ports/embedder";
import { type ChunkOptions, chunkDocument, type DocumentChunk } from "./chunk";
import { isParseable, parseDocument } from "./parse";

// Ingestion (PLAN.md §8 RAG steps 2–4), run as a job: read the upload from
// storage, parse it, chunk it, embed the chunks, and store them, moving the
// file `uploaded → processing → ready | failed`. The job registry (ticket
// 014) registers `ingestFileJob(deps)` under `INGEST_FILE_JOB` and
// `reindexEmbeddingsJob(deps)` under `REINDEX_EMBEDDINGS_JOB`; the upload
// handler enqueues the first, boot enqueues the second whenever
// `embeddings.model` is set, and it finds nothing to do unless the model
// changed.
//
// Retries: a problem with the file itself (unreadable PDF, not text) fails
// it for good and the job succeeds, since trying again can't help. A problem
// with a service (storage, the embedding provider) fails the file with a
// message saying so and fails the job, so the queue retries; the next
// attempt starts from `processing` again.

export const INGEST_FILE_JOB = "rag.ingest-file";
export const REINDEX_EMBEDDINGS_JOB = "rag.reindex-embeddings";

export const ingestFileJobDataSchema = z.object({ fileId: fileIdSchema });
export type IngestFileJobData = z.infer<typeof ingestFileJobDataSchema>;

export const reindexEmbeddingsJobDataSchema = z.object({
  /** The model files should be embedded with now: `embeddings.model`. */
  model: modelRefSchema,
});
export type ReindexEmbeddingsJobData = z.infer<
  typeof reindexEmbeddingsJobDataSchema
>;

/** What ingestion needs to know about a file. */
export interface IngestionFile {
  readonly id: FileId;
  readonly mediaType: string;
  readonly name: string;
  readonly purpose: FilePurpose;
  readonly storageKey: string;
}

export interface IngestedChunk {
  /** `null` when there's no embedding model: stored, but not searchable. */
  readonly embedding: readonly number[] | null;
  readonly page: number | null;
  readonly text: string;
  readonly tokenCount: number;
}

interface NotFound {
  readonly type: "not_found";
}

/** The `file` / `file_chunk` writes ingestion makes; the server backs it with `@workspace/db`. */
export interface IngestionStore {
  readonly getFile: (id: FileId) => AsyncResult<IngestionFile, NotFound>;
  /** Files ready but not embedded with `model`, by id, after `after`. */
  readonly listFilesToReindex: (
    model: ModelRef,
    page: { readonly after: FileId | null; readonly limit: number }
  ) => Promise<readonly FileId[]>;
  /** Replaces the file's chunks and marks it `ready`, atomically. */
  readonly replaceChunks: (
    id: FileId,
    chunks: readonly IngestedChunk[],
    model: ModelRef | null
  ) => AsyncResult<unknown, NotFound>;
  /** `message` is shown to the user for `failed`. */
  readonly setState: (
    id: FileId,
    state: "processing" | "failed",
    message?: string
  ) => AsyncResult<unknown, NotFound>;
}

/** Reads an object's bytes from storage. */
export type ReadBlob = (
  key: string,
  options?: { readonly signal?: AbortSignal }
) => AsyncResult<Uint8Array, { readonly message: string }>;

export interface IngestDeps {
  readonly chunking?: ChunkOptions;
  /** `null` when `embeddings.model` isn't set: chunks are stored unembedded. */
  readonly embedder: Embedder | null;
  readonly readBlob: ReadBlob;
  readonly store: IngestionStore;
}

export type IngestOutcome =
  | {
      readonly chunkCount: number;
      readonly embeddingModel: ModelRef | null;
      readonly state: "ready";
    }
  | { readonly message: string; readonly state: "failed" }
  /** The file was deleted before the job ran. */
  | { readonly state: "gone" };

/** Purposes whose text is chunked and embedded; skill files are read by path, not searched. */
const INDEXED_PURPOSES: ReadonlySet<FilePurpose> = new Set([
  "attachment",
  "knowledge",
]);

const embedderMessage = (error: EmbedderError): string => {
  switch (error.type) {
    case "rate_limited":
      return "The embedding provider is rate limiting requests; this file will be retried.";
    case "too_large":
      return "Part of this file is too long for the embedding model.";
    case "unavailable":
      return "The embedding provider is unavailable; this file will be retried.";
    default:
      return error satisfies never;
  }
};

const toIngested = (
  { page, text, tokenCount }: DocumentChunk,
  embedding: readonly number[] | null
): IngestedChunk => ({ embedding, page, text, tokenCount });

const embedAll = async (
  embedder: Embedder,
  chunks: readonly DocumentChunk[],
  signal: AbortSignal | undefined
): AsyncResult<(readonly number[])[], EmbedderError> => {
  const vectors: (readonly number[])[] = [];
  for (let start = 0; start < chunks.length; start += embedder.maxBatchSize) {
    const batch = chunks
      .slice(start, start + embedder.maxBatchSize)
      .map((chunk) => chunk.text);
    // biome-ignore lint/performance/noAwaitInLoops: batches go one at a time so a big file doesn't trip the provider's rate limit.
    const result = await embedder.embed(batch, { signal });
    if (!result.ok) {
      return result;
    }
    vectors.push(...result.value.embeddings);
  }
  return ok(vectors);
};

/**
 * Ingests one file. `ok` covers every outcome the file itself decides
 * (including `failed`); `err` means a service failed and the job should
 * be retried.
 */
export const ingestFile = async (
  deps: IngestDeps,
  fileId: FileId,
  signal?: AbortSignal
): AsyncResult<IngestOutcome, string> => {
  const { embedder, store } = deps;
  const found = await store.getFile(fileId);
  if (!found.ok) {
    return ok({ state: "gone" });
  }
  const file = found.value;

  const ready = async (
    rows: readonly IngestedChunk[],
    model: ModelRef | null
  ): AsyncResult<IngestOutcome, string> => {
    const stored = await store.replaceChunks(file.id, rows, model);
    return stored.ok
      ? ok({ chunkCount: rows.length, embeddingModel: model, state: "ready" })
      : ok({ state: "gone" });
  };
  const fail = async (message: string): AsyncResult<IngestOutcome, string> => {
    const marked = await store.setState(file.id, "failed", message);
    return ok(marked.ok ? { message, state: "failed" } : { state: "gone" });
  };

  // Images and other binaries attach fine; there's just nothing to index.
  if (
    !(
      INDEXED_PURPOSES.has(file.purpose) &&
      isParseable(file.mediaType, file.name)
    )
  ) {
    return ready([], null);
  }

  const processing = await store.setState(file.id, "processing");
  if (!processing.ok) {
    return ok({ state: "gone" });
  }

  const bytes = await deps.readBlob(file.storageKey, { signal });
  if (!bytes.ok) {
    await store.setState(
      file.id,
      "failed",
      "The file couldn't be read from storage; it will be retried."
    );
    return err(`storage: ${bytes.error.message}`);
  }

  const parsed = await parseDocument(bytes.value, file);
  if (!parsed.ok) {
    return parsed.error.type === "unsupported"
      ? ready([], null)
      : fail(parsed.error.message);
  }

  const chunks = chunkDocument(parsed.value.pages, deps.chunking);
  if (!embedder) {
    return ready(
      chunks.map((chunk) => toIngested(chunk, null)),
      null
    );
  }

  const vectors = await embedAll(embedder, chunks, signal);
  if (!vectors.ok) {
    const message = embedderMessage(vectors.error);
    if (vectors.error.type === "too_large") {
      return fail(message);
    }
    await store.setState(file.id, "failed", message);
    return err(`embeddings: ${vectors.error.type}`);
  }
  return ready(
    chunks.map((chunk, index) =>
      toIngested(chunk, vectors.value[index] ?? null)
    ),
    embedder.model
  );
};

/** The job queue's handler signature, restated so this package needn't depend on the server's. */
export type RagJobHandler<TData> = (
  job: { readonly data: TData },
  signal: AbortSignal
) => AsyncResult<JsonValue | undefined, string>;

/** The `INGEST_FILE_JOB` handler. */
export const ingestFileJob =
  (deps: IngestDeps): RagJobHandler<IngestFileJobData> =>
  async (job, signal) => {
    const outcome = await ingestFile(deps, job.data.fileId, signal);
    return outcome.ok ? ok({ ...outcome.value }) : outcome;
  };

export interface ReindexDeps {
  /** Enqueues `INGEST_FILE_JOB` for a file, keyed by the file id so repeats collapse. */
  readonly enqueueIngest: (
    fileId: FileId
  ) => AsyncResult<unknown, { readonly type: string }>;
  readonly pageSize?: number;
  readonly store: Pick<IngestionStore, "listFilesToReindex">;
}

/**
 * The `REINDEX_EMBEDDINGS_JOB` handler: queues re-ingestion for every file
 * not embedded with `model`. Each file swaps its chunks atomically, so
 * search keeps answering from the old vectors (for files the old model
 * embedded) until the new ones land.
 */
export const reindexEmbeddingsJob =
  ({
    enqueueIngest,
    pageSize = 500,
    store,
  }: ReindexDeps): RagJobHandler<ReindexEmbeddingsJobData> =>
  async (job, signal) => {
    let after: FileId | null = null;
    let enqueued = 0;
    for (;;) {
      if (signal.aborted) {
        return err("stopped");
      }
      // biome-ignore lint/performance/noAwaitInLoops: keyset pages, each after the last.
      const ids = await store.listFilesToReindex(job.data.model, {
        after,
        limit: pageSize,
      });
      const queued = await Promise.all(ids.map((id) => enqueueIngest(id)));
      const failed = queued.find((result) => !result.ok);
      if (failed && !failed.ok) {
        return err(`queue: ${failed.error.type}`);
      }
      enqueued += ids.length;
      if (ids.length < pageSize) {
        return ok({ enqueued, model: job.data.model });
      }
      after = ids.at(-1) ?? null;
    }
  };
