import type { JobId, JsonValue } from "@workspace/contract/schemas/common";
import { newId } from "@workspace/shared/ids";
import { err, ok } from "@workspace/shared/result";
import type { JobWithMetadata, PgBoss } from "pg-boss";

import {
  type Job,
  type JobMap,
  type JobQueue,
  type SendOptions,
  sendOptionsSchema,
  type TypedJob,
} from "../ports/job-queue";

// The JobQueue port over pg-boss 12, in-process in `web` for M1 (D4). The
// same adapter runs in `apps/worker` later; only where `startJobs` is called
// changes.
//
// Every queue is created with pg-boss's `exclusive` policy: at most one job
// per key waits or runs. That is the port's `singletonKey` promise; a job
// sent without a key gets its own id as the key, so it never collides.

const CRON = /^\s*(\S+\s+){4}\S+\s*$/;
const MISSING_QUEUE = /^Queue \S+ does not exist/;

const iso = (date: Date | string | null | undefined): string | null =>
  date ? new Date(date).toISOString() : null;

const toJob = (job: JobWithMetadata<unknown>): Job => ({
  completedAt: iso(job.completedOn),
  createdAt: iso(job.createdOn) ?? new Date().toISOString(),
  data: (job.data ?? null) as JsonValue,
  id: job.id as JobId,
  name: job.name,
  output: (job.output ?? null) as JsonValue,
  retryCount: job.retryCount,
  singletonKey: job.singletonKey === job.id ? null : job.singletonKey,
  startAfter: iso(job.startAfter) ?? new Date().toISOString(),
  state: job.state,
});

const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

export interface PgBossQueueOptions {
  readonly boss: PgBoss;
  /** Every job name the registry knows: `getJob` and `cancel` search these. */
  readonly names: readonly string[];
  /** Base poll interval for workers, in seconds (pg-boss's minimum is 0.5). */
  readonly pollingIntervalSeconds?: number;
}

export const createPgBossQueue = <Jobs extends JobMap>({
  boss,
  names,
  pollingIntervalSeconds,
}: PgBossQueueOptions): JobQueue<Jobs> => {
  const created = new Map<string, Promise<void>>();

  const ensureQueue = (name: string): Promise<void> => {
    const existing = created.get(name);
    if (existing) {
      return existing;
    }
    const creating = boss
      .getQueue(name)
      .then((queue) =>
        queue ? undefined : boss.createQueue(name, { policy: "exclusive" })
      );
    created.set(name, creating);
    creating.catch(() => created.delete(name));
    return creating;
  };

  const sendOptions = (id: JobId, options: SendOptions = {}) => {
    const parsed = sendOptionsSchema.parse(options);
    return {
      expireInSeconds: parsed.expireInSeconds,
      id,
      priority: parsed.priority,
      retryBackoff: parsed.retryBackoff,
      retryDelay: parsed.retryDelaySeconds,
      retryLimit: parsed.retryLimit,
      singletonKey: parsed.singletonKey ?? id,
      startAfter: parsed.startAfterSeconds,
    };
  };

  const find = async (id: JobId): Promise<Job | null> => {
    for (const name of names) {
      // A queue is created on first use; one that doesn't exist yet holds nothing.
      // biome-ignore lint/performance/noAwaitInLoops: a handful of names, and the first hit ends the search.
      const job = await boss
        .getJobById<unknown>(name, id)
        .catch((cause: unknown) => {
          if (MISSING_QUEUE.test(messageOf(cause))) {
            return null;
          }
          throw cause;
        });
      if (job) {
        return toJob(job);
      }
    }
    return null;
  };

  return {
    cancel: async (id) => {
      try {
        const job = await find(id);
        if (job) {
          await boss.cancel(job.name, id);
        }
        return ok(undefined);
      } catch (cause) {
        return err({ message: messageOf(cause), type: "unavailable" });
      }
    },

    enqueue: async (name, data, options) => {
      try {
        await ensureQueue(name);
        const id = newId("job");
        const sent = await boss.send(
          name,
          data as object,
          sendOptions(id, options)
        );
        return ok(sent === null ? null : (sent as JobId));
      } catch (cause) {
        return err({ message: messageOf(cause), type: "unavailable" });
      }
    },

    getJob: async (id) => {
      try {
        return ok(await find(id));
      } catch (cause) {
        return err({ message: messageOf(cause), type: "unavailable" });
      }
    },

    schedule: async (name, cron, data, options = {}) => {
      if (!CRON.test(cron)) {
        return err({
          message: `not a 5-field cron: ${cron}`,
          type: "invalid_cron",
        });
      }
      try {
        await ensureQueue(name);
        const { tz, ...send } = options;
        const parsed = sendOptionsSchema.parse(send);
        await boss.schedule(name, cron, data as object, {
          expireInSeconds: parsed.expireInSeconds,
          priority: parsed.priority,
          retryBackoff: parsed.retryBackoff,
          retryDelay: parsed.retryDelaySeconds,
          retryLimit: parsed.retryLimit,
          ...(parsed.singletonKey ? { singletonKey: parsed.singletonKey } : {}),
          tz,
        });
        return ok(undefined);
      } catch (cause) {
        return err({ message: messageOf(cause), type: "invalid_cron" });
      }
    },

    stop: () => boss.stop({ graceful: true }),

    unschedule: async (name) => {
      try {
        await boss.unschedule(name);
        return ok(undefined);
      } catch (cause) {
        return err({ message: messageOf(cause), type: "unavailable" });
      }
    },

    work: async (name, handler, options = {}) => {
      try {
        await ensureQueue(name);
        await boss.work<Jobs[typeof name]>(
          name,
          {
            batchSize: 1,
            includeMetadata: true,
            localConcurrency: options.concurrency ?? 1,
            ...(pollingIntervalSeconds ? { pollingIntervalSeconds } : {}),
          },
          async (jobs) => {
            const outputs: unknown[] = [];
            // `includeMetadata` is on; the overload can't see it through the spread.
            for (const job of jobs as unknown as JobWithMetadata<
              Jobs[typeof name]
            >[]) {
              const typed = toJob(job) as TypedJob<Jobs[typeof name]>;
              // biome-ignore lint/performance/noAwaitInLoops: batchSize is 1.
              const result = await handler(
                { ...typed, data: job.data },
                job.signal
              );
              if (!result.ok) {
                // pg-boss fails (and retries) a job whose handler throws.
                throw new Error(result.error);
              }
              outputs.push(result.value ?? null);
            }
            return outputs[0] ?? null;
          }
        );
        return ok(undefined);
      } catch (cause) {
        return err({ message: messageOf(cause), type: "unavailable" });
      }
    },
  };
};
