import type { JobId, JsonValue } from "@workspace/contract/schemas/common";
import { newId } from "@workspace/shared/ids";
import { err, ok } from "@workspace/shared/result";

import {
  type Job,
  type JobHandler,
  type JobMap,
  type JobQueue,
  type SendOptions,
  sendOptionsSchema,
  type TypedJob,
} from "./job-queue";

// In-memory JobQueue with pg-boss semantics and a manual clock: nothing runs
// until the test calls `drain()`, which works every due job (and any retries
// that fall due) until the queue is idle. Schedules never fire on their own;
// `fireSchedule(name)` enqueues one run, as the cron tick would.

const CRON = /^\s*(\S+\s+){4}\S+\s*$/;

interface Entry {
  handlerOptions: ReturnType<typeof sendOptionsSchema.parse>;
  job: Job;
}

export interface MemoryJobQueue<Jobs extends JobMap> extends JobQueue<Jobs> {
  /** Works every due job until none is left; returns how many attempts ran. */
  drain: () => Promise<number>;
  /** Enqueues one run of a schedule, as its cron tick would. */
  fireSchedule: (name: keyof Jobs & string) => Promise<JobId | null>;
  readonly jobs: () => readonly Job[];
  readonly schedules: () => ReadonlyMap<
    string,
    { cron: string; data: JsonValue }
  >;
}

export const createMemoryJobQueue = <Jobs extends JobMap>({
  now = () => new Date(),
}: {
  readonly now?: () => Date;
} = {}): MemoryJobQueue<Jobs> => {
  const entries = new Map<JobId, Entry>();
  const handlers = new Map<string, JobHandler<JsonValue>>();
  const schedules = new Map<
    string,
    { cron: string; data: JsonValue; options: SendOptions }
  >();
  let stopped = false;
  const controller = new AbortController();

  const iso = (date: Date) => date.toISOString();
  const plusSeconds = (seconds: number) =>
    new Date(now().getTime() + seconds * 1000);

  const enqueue = (
    name: string,
    data: JsonValue,
    options: SendOptions = {}
  ) => {
    const parsed = sendOptionsSchema.parse(options);
    if (parsed.singletonKey) {
      const busy = [...entries.values()].some(
        ({ job }) =>
          job.name === name &&
          job.singletonKey === parsed.singletonKey &&
          ["created", "retry", "active"].includes(job.state)
      );
      if (busy) {
        return null;
      }
    }
    const id = newId("job");
    entries.set(id, {
      handlerOptions: parsed,
      job: {
        completedAt: null,
        createdAt: iso(now()),
        data,
        id,
        name,
        output: null,
        retryCount: 0,
        singletonKey: parsed.singletonKey ?? null,
        startAfter: iso(plusSeconds(parsed.startAfterSeconds)),
        state: "created",
      },
    });
    return id;
  };

  const due = () =>
    [...entries.values()]
      .filter(
        ({ job }) =>
          (job.state === "created" || job.state === "retry") &&
          handlers.has(job.name) &&
          new Date(job.startAfter) <= now()
      )
      .sort(
        (a, b) =>
          b.handlerOptions.priority - a.handlerOptions.priority ||
          a.job.createdAt.localeCompare(b.job.createdAt)
      );

  const attempt = async (entry: Entry) => {
    const handler = handlers.get(entry.job.name);
    if (!handler) {
      return;
    }
    entry.job = { ...entry.job, state: "active" };
    let outcome: { error: string } | { output: JsonValue | undefined };
    try {
      const result = await handler(
        entry.job as TypedJob<JsonValue>,
        controller.signal
      );
      outcome = result.ok ? { output: result.value } : { error: result.error };
    } catch (cause) {
      outcome = {
        error: cause instanceof Error ? cause.message : String(cause),
      };
    }
    if (entry.job.state === "cancelled") {
      return;
    }
    if ("output" in outcome) {
      entry.job = {
        ...entry.job,
        completedAt: iso(now()),
        output: outcome.output ?? null,
        state: "completed",
      };
      return;
    }
    const { retryBackoff, retryDelaySeconds, retryLimit } =
      entry.handlerOptions;
    const retryCount = entry.job.retryCount + 1;
    if (retryCount > retryLimit) {
      entry.job = {
        ...entry.job,
        completedAt: iso(now()),
        output: outcome.error,
        retryCount,
        state: "failed",
      };
      return;
    }
    const delay = retryBackoff
      ? retryDelaySeconds * 2 ** (retryCount - 1)
      : retryDelaySeconds;
    entry.job = {
      ...entry.job,
      output: outcome.error,
      retryCount,
      startAfter: iso(plusSeconds(delay)),
      state: "retry",
    };
  };

  return {
    cancel: (id) => {
      const entry = entries.get(id);
      if (entry && !["completed", "failed"].includes(entry.job.state)) {
        entry.job = {
          ...entry.job,
          completedAt: iso(now()),
          state: "cancelled",
        };
      }
      return Promise.resolve(ok(undefined));
    },

    drain: async () => {
      let attempts = 0;
      for (let next = due(); next.length > 0 && !stopped; next = due()) {
        for (const entry of next) {
          // biome-ignore lint/performance/noAwaitInLoops: one at a time, in priority order, so tests are deterministic.
          await attempt(entry);
          attempts += 1;
        }
      }
      return attempts;
    },

    enqueue: (name, data, options) =>
      Promise.resolve(ok(enqueue(name, data, options))),

    fireSchedule: (name) => {
      const schedule = schedules.get(name);
      return Promise.resolve(
        schedule ? enqueue(name, schedule.data, schedule.options) : null
      );
    },

    getJob: (id) => Promise.resolve(ok(entries.get(id)?.job ?? null)),

    jobs: () => [...entries.values()].map(({ job }) => job),

    schedule: (name, cron, data, options = {}) => {
      if (!CRON.test(cron)) {
        return Promise.resolve(
          err({
            message: `"${cron}" isn't a 5-field cron expression`,
            type: "invalid_cron" as const,
          })
        );
      }
      const { tz: _tz, ...sendOptions } = options;
      schedules.set(name, { cron, data, options: sendOptions });
      return Promise.resolve(ok(undefined));
    },

    schedules: () =>
      new Map(
        [...schedules].map(([name, { cron, data }]) => [name, { cron, data }])
      ),

    stop: () => {
      stopped = true;
      controller.abort();
      return Promise.resolve();
    },

    unschedule: (name) => {
      schedules.delete(name);
      return Promise.resolve(ok(undefined));
    },

    work: (name, handler) => {
      // Each name's data type is fixed by `Jobs`; the map stores them erased.
      handlers.set(name, handler as JobHandler<JsonValue>);
      return Promise.resolve(ok(undefined));
    },
  };
};
