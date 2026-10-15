import {
  INGEST_FILE_JOB,
  ingestFileJobDataSchema,
  REINDEX_EMBEDDINGS_JOB,
  reindexEmbeddingsJobDataSchema,
} from "@workspace/ai/rag/ingest";
import {
  conversationIdSchema,
  dotScheduleIdSchema,
  runIdSchema,
  userIdSchema,
} from "@workspace/contract/schemas/common";
import { err } from "@workspace/shared/result";
import { z } from "zod";

import type { JobHandler, JobQueue, SendOptions } from "../ports/job-queue";

// The job registry (D4): every background job's name, its data schema, the
// defaults it's sent with, and its handler, in one place. Moving jobs to
// `apps/worker` later means calling `registerJobs` there instead of in `web`;
// no job code changes.
//
// Handlers from other workstreams arrive in `JobHandlers` (ingestion and
// re-indexing from 021's `createKnowledgeJobs`, under the names it enqueues
// with). A job without a handler waits in the queue rather than being dropped.

export const jobSchemas = {
  /** Fires one claimed occurrence of a Dot's schedule (172). */
  "dot.run": z.object({
    occurrence: z.iso.datetime(),
    scheduleId: dotScheduleIdSchema,
  }),
  /** Claims every Dot schedule that's due and enqueues a `dot.run` each; every minute. */
  "dot.tick": z.object({}),
  /** Runs an `eval_run` (a dataset against an agent version) and stores its scores (041). */
  "eval.run": z.object({ evalRunId: z.uuid() }),
  /** Parses, chunks and embeds one uploaded file (PLAN.md §8 RAG). */
  [INGEST_FILE_JOB]: ingestFileJobDataSchema,
  /** Queues ingestion for every file embedded with another model. */
  [REINDEX_EMBEDDINGS_JOB]: reindexEmbeddingsJobDataSchema,
  /** Drops a finished run's stored chunks; resume only needs them for a while. */
  "run.prune": z.object({ runId: runIdSchema }),
  /** Deletes idle Agent Builder test chats (033); runs on a schedule. */
  "testChat.prune": z.object({}),
  /** Names a conversation after its first turn. */
  "title.generate": z.object({
    conversationId: conversationIdSchema,
    /** Whose view of the conversation the job reads it through (the run's author). */
    userId: userIdSchema,
  }),
};

export type JobName = keyof typeof jobSchemas;

/** Job names to their data types: the `JobMap` the queue is typed with. */
export type Jobs = { [N in JobName]: z.infer<(typeof jobSchemas)[N]> };

export const JOB_NAMES = Object.keys(jobSchemas) as JobName[];

/** Defaults per job; callers may override. */
export const jobDefaults: { readonly [N in JobName]: SendOptions } = {
  // The occurrence's idempotency key makes a retry safe; one retry covers a blip.
  "dot.run": { expireInSeconds: 300, retryDelaySeconds: 15, retryLimit: 1 },
  // The next tick picks up whatever a failed one left.
  "dot.tick": { retryLimit: 0 },
  "eval.run": { expireInSeconds: 3600, retryLimit: 0 },
  [INGEST_FILE_JOB]: {
    retryBackoff: true,
    retryDelaySeconds: 10,
    retryLimit: 3,
  },
  // One pass enqueues per-file jobs; a failed pass is redone at next boot.
  [REINDEX_EMBEDDINGS_JOB]: { retryLimit: 1, singletonKey: "reindex" },
  // Long enough for a dropped client to reconnect and replay.
  "run.prune": { retryLimit: 1, startAfterSeconds: 600 },
  // The next scheduled pass picks up whatever a failed one left.
  "testChat.prune": { retryLimit: 0 },
  "title.generate": { retryDelaySeconds: 5, retryLimit: 2 },
};

export type JobHandlers = {
  readonly [N in JobName]?: JobHandler<Jobs[N]>;
};

/**
 * Registers every job that has a handler. Data is parsed with the job's
 * schema first: a job enqueued by an older build fails cleanly instead of
 * running on bad input.
 */
export const registerJobs = async (
  queue: JobQueue<Jobs>,
  handlers: JobHandlers
): Promise<readonly JobName[]> => {
  const registered: JobName[] = [];
  for (const name of JOB_NAMES) {
    const handler = handlers[name] as JobHandler<Jobs[JobName]> | undefined;
    if (!handler) {
      continue;
    }
    const schema = jobSchemas[name] as z.ZodType<Jobs[JobName]>;
    // biome-ignore lint/performance/noAwaitInLoops: registration order doesn't matter, and it's a few names once at boot.
    const worked = await queue.work(name, (job, signal) => {
      const data = schema.safeParse(job.data);
      return data.success
        ? handler({ ...job, data: data.data }, signal)
        : Promise.resolve(err(`invalid ${name} data: ${data.error.message}`));
    });
    if (worked.ok) {
      registered.push(name);
    }
  }
  return registered;
};

/** Enqueues a job with its registry defaults. */
export const enqueueJob = <N extends JobName>(
  queue: JobQueue<Jobs>,
  name: N,
  data: Jobs[N],
  options: SendOptions = {}
) => queue.enqueue(name, data, { ...jobDefaults[name], ...options });
