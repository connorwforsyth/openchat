import { type ConstructorOptions, PgBoss } from "pg-boss";

import type { JobQueue } from "../ports/job-queue";
import { createPgBossQueue } from "./pg-boss-queue";
import { JOB_NAMES, type Jobs } from "./registry";

// Starts pg-boss in this process (D4: in `web` for M1, `apps/worker` later).
// It installs or migrates its own schema (`pgboss`) on start. Handlers are
// registered afterwards with `registerJobs`, because some of them need
// services that in turn enqueue jobs.

export interface JobRuntime {
  readonly queue: JobQueue<Jobs>;
  /** Stops fetching, waits for running handlers, closes pg-boss's pool. */
  readonly stop: () => Promise<void>;
}

export interface StartJobsOptions {
  /** A connection string, or `{ db: fromPglite(client), backend: "pglite" }` in tests. */
  readonly connection: ConstructorOptions;
  /** Worker poll interval in seconds (default 2; tests use pg-boss's minimum, 0.5). */
  readonly pollingIntervalSeconds?: number;
  /** pg-boss's own errors and warnings (it retries by itself); never secrets. */
  readonly report?: (message: string, cause: unknown) => void;
}

/**
 * Starts the job queue. `null` when pg-boss can't start (the database is
 * down or refuses the schema): the app keeps serving chat without titles or
 * ingestion rather than failing to boot.
 */
export const startJobs = async ({
  connection,
  pollingIntervalSeconds,
  report = () => undefined,
}: StartJobsOptions): Promise<JobRuntime | null> => {
  const boss = new PgBoss(connection);
  // Without a listener an EventEmitter `error` would crash the process.
  boss.on("error", (cause) => report("job queue error", cause));
  try {
    await boss.start();
  } catch (cause) {
    report("job queue didn't start", cause);
    await boss.stop({ graceful: false }).catch(() => undefined);
    return null;
  }
  const queue = createPgBossQueue<Jobs>({
    boss,
    names: JOB_NAMES,
    pollingIntervalSeconds,
  });
  return { queue, stop: () => queue.stop() };
};
