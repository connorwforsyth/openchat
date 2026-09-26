import type { Embedder } from "@workspace/ai/ports/embedder";
import {
  INGEST_FILE_JOB,
  type IngestFileJobData,
  type IngestionStore,
  ingestFileJob,
  REINDEX_EMBEDDINGS_JOB,
  type ReadBlob,
  type ReindexEmbeddingsJobData,
  reindexEmbeddingsJob,
} from "@workspace/ai/rag/ingest";
import type { FileId } from "@workspace/contract/schemas/common";
import type { Db } from "@workspace/db/client";
import {
  getFile,
  listFileIdsToReindex,
  replaceChunks,
  setFileState,
} from "@workspace/db/queries/files";
import { err, ok } from "@workspace/shared/result";

import type { JobHandler, JobQueue } from "../ports/job-queue";
import type { Storage } from "../ports/storage";

// Ingestion wired to the database, storage and the job queue. The job
// registry (ticket 014) registers `createKnowledgeJobs(deps)`; the upload
// handler enqueues through `enqueueIngest`.

/** The knowledge jobs and their data, for the registry's `JobMap`. */
export interface KnowledgeJobs {
  [INGEST_FILE_JOB]: IngestFileJobData;
  [REINDEX_EMBEDDINGS_JOB]: ReindexEmbeddingsJobData;
  [name: string]: IngestFileJobData | ReindexEmbeddingsJobData;
}

export type KnowledgeQueue = Pick<JobQueue<KnowledgeJobs>, "enqueue">;

export const createIngestionStore = (db: Db): IngestionStore => ({
  getFile: (id) => getFile(db, id),
  listFilesToReindex: (model, page) => listFileIdsToReindex(db, model, page),
  replaceChunks: (id, chunks, model) =>
    replaceChunks(
      db,
      id,
      chunks.map(({ embedding, page, text, tokenCount }) => ({
        embedding,
        page,
        text,
        tokenCount,
      })),
      model
    ),
  setState: (id, state, message) => setFileState(db, id, state, message),
});

export const readBlobFrom =
  (storage: Storage): ReadBlob =>
  async (key) => {
    const found = await storage.get(key);
    if (!found.ok) {
      return err({ message: found.error.type });
    }
    try {
      return ok(
        new Uint8Array(await new Response(found.value.body).arrayBuffer())
      );
    } catch {
      return err({ message: "read_failed" });
    }
  };

/** Queues ingestion; the file id is the singleton key, so a double enqueue runs once. */
export const enqueueIngest = (queue: KnowledgeQueue, fileId: FileId) =>
  queue.enqueue(
    INGEST_FILE_JOB,
    { fileId },
    {
      retryBackoff: true,
      retryDelaySeconds: 30,
      retryLimit: 4,
      singletonKey: fileId,
    }
  );

export interface KnowledgeJobDeps {
  readonly db: Db;
  /** `null` when `embeddings.model` isn't set. */
  readonly embedder: Embedder | null;
  readonly queue: KnowledgeQueue;
  readonly storage: Storage;
}

/** The handlers for the job registry, keyed by job name. */
export const createKnowledgeJobs = ({
  db,
  embedder,
  queue,
  storage,
}: KnowledgeJobDeps): {
  readonly [INGEST_FILE_JOB]: JobHandler<IngestFileJobData>;
  readonly [REINDEX_EMBEDDINGS_JOB]: JobHandler<ReindexEmbeddingsJobData>;
} => {
  const store = createIngestionStore(db);
  return {
    [INGEST_FILE_JOB]: ingestFileJob({
      embedder,
      readBlob: readBlobFrom(storage),
      store,
    }),
    [REINDEX_EMBEDDINGS_JOB]: reindexEmbeddingsJob({
      enqueueIngest: (fileId) => enqueueIngest(queue, fileId),
      store,
    }),
  };
};
