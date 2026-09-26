import {
  type JobId,
  type JsonValue,
  jobIdSchema,
  jsonValueSchema,
} from "@workspace/contract/schemas/common";
import type { AsyncResult } from "@workspace/shared/result";
import { z } from "zod";

// The JobQueue port (D4), shaped after pg-boss 12, which runs in-process in
// `web` for M1 and moves to `apps/worker` later without job code changing.
// Handlers are plain functions registered in one place (the job registry);
// job data is JSON, validated by the registry's zod schema per job name.

/** pg-boss's job states. */
export const jobStateSchema = z.enum([
  "created",
  "retry",
  "active",
  "completed",
  "cancelled",
  "failed",
]);
export type JobState = z.infer<typeof jobStateSchema>;

/** `send` options, with pg-boss's defaults. */
export const sendOptionsSchema = z.object({
  /** Seconds before the active job is considered stuck and retried. */
  expireInSeconds: z.int().min(1).default(900),
  /** Higher runs first. */
  priority: z.int().default(0),
  /** Double the delay after each failure. */
  retryBackoff: z.boolean().default(false),
  retryDelaySeconds: z.int().min(0).default(0),
  /** Retries after the first failure (so `2` means up to three attempts). */
  retryLimit: z.int().min(0).default(2),
  /**
   * At most one job with this key waits or runs at a time; a duplicate
   * enqueue returns `null`, like pg-boss. Use it for "re-index this file".
   */
  singletonKey: z.string().min(1).optional(),
  startAfterSeconds: z.int().min(0).default(0),
});
export type SendOptions = z.input<typeof sendOptionsSchema>;

export const jobSchema = z.object({
  completedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  data: jsonValueSchema,
  id: jobIdSchema,
  name: z.string().min(1),
  /** What the handler returned, or the failure message. */
  output: jsonValueSchema.nullable(),
  /** Failures so far. */
  retryCount: z.int().min(0),
  singletonKey: z.string().nullable(),
  startAfter: z.iso.datetime(),
  state: jobStateSchema,
});
export type Job = z.infer<typeof jobSchema>;

export const jobQueueErrorSchema = z.discriminatedUnion("type", [
  z.object({ message: z.string(), type: z.literal("invalid_cron") }),
  z.object({ name: z.string(), type: z.literal("no_worker") }),
  z.object({ message: z.string(), type: z.literal("unavailable") }),
]);
export type JobQueueError = z.infer<typeof jobQueueErrorSchema>;

/** A job's data, typed for its name. */
export interface TypedJob<TData> extends Omit<Job, "data"> {
  readonly data: TData;
}

/**
 * Runs one job. An `err` (or a throw) fails this attempt and pg-boss retries
 * it within `retryLimit`; the `ok` value is stored as the job's output.
 */
export type JobHandler<TData> = (
  job: TypedJob<TData>,
  signal: AbortSignal
) => AsyncResult<JsonValue | undefined, string>;

/** Job names mapped to their data types. */
export type JobMap = Record<string, JsonValue>;

export interface JobQueue<Jobs extends JobMap> {
  cancel: (id: JobId) => AsyncResult<void, JobQueueError>;
  /** Returns the new job's id, or `null` when `singletonKey` suppressed it. */
  enqueue: <N extends keyof Jobs & string>(
    name: N,
    data: Jobs[N],
    options?: SendOptions
  ) => AsyncResult<JobId | null, JobQueueError>;
  getJob: (id: JobId) => AsyncResult<Job | null, JobQueueError>;
  /**
   * Enqueues `name` on a cron schedule (5-field cron, `tz` IANA zone). One
   * schedule per name; scheduling again replaces it. Survives restarts.
   */
  schedule: <N extends keyof Jobs & string>(
    name: N,
    cron: string,
    data: Jobs[N],
    options?: SendOptions & { readonly tz?: string }
  ) => AsyncResult<void, JobQueueError>;
  /** Stops fetching new jobs and waits for active handlers to finish. */
  stop: () => Promise<void>;
  unschedule: (name: keyof Jobs & string) => AsyncResult<void, JobQueueError>;
  /** Registers the handler for `name`. One per name per process. */
  work: <N extends keyof Jobs & string>(
    name: N,
    handler: JobHandler<Jobs[N]>,
    options?: { readonly concurrency?: number }
  ) => AsyncResult<void, JobQueueError>;
}
