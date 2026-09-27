import type { Health, HealthCheck } from "@workspace/contract/schemas/health";
import type { Db } from "@workspace/db/client";
import { sql } from "drizzle-orm";

// `meta.health` (042): liveness and readiness for compose healthchecks.
// Answering at all is liveness; each probe says whether a dependency the
// app needs for real work is up. Probes never throw and never put a URL or
// a driver's message in the report (it's public): only our own sentences.

/** One dependency's check. Resolves, never rejects. */
export type HealthProbe = () => Promise<HealthCheck>;

export interface HealthProbes {
  readonly database: HealthProbe;
  readonly jobs: HealthProbe;
}

const up: HealthCheck = { message: null, status: "up" };

export const down = (message: string): HealthCheck => ({
  message,
  status: "down",
});

/** Always down, for a dependency that isn't there at all. */
export const downProbe =
  (message: string): HealthProbe =>
  () =>
    Promise.resolve(down(message));

/** How long a ping may take before the database counts as down. */
const PING_TIMEOUT_MS = 2000;

/** `select 1`, bounded so a hung pool can't hang the healthcheck. */
export const databaseProbe =
  (db: Db, timeoutMs = PING_TIMEOUT_MS): HealthProbe =>
  async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<HealthCheck>((resolve) => {
      timer = setTimeout(
        () => resolve(down("the database didn't answer in time")),
        timeoutMs
      );
    });
    const ping = db
      .execute(sql`select 1`)
      .then(() => up)
      .catch(() => down("the database didn't answer"));
    try {
      return await Promise.race([ping, timeout]);
    } finally {
      clearTimeout(timer);
    }
  };

/** The job queue is up once pg-boss started (`startJobs` returns `null` otherwise). */
export const jobsProbe = (running: boolean): HealthProbe =>
  running ? () => Promise.resolve(up) : downProbe("the job queue didn't start");

/** Runs every probe; `ok` only when all are up. */
export const checkHealth = async (probes: HealthProbes): Promise<Health> => {
  const [database, jobs] = await Promise.all([
    probes.database(),
    probes.jobs(),
  ]);
  const checks = { database, jobs };
  const allUp = Object.values(checks).every((check) => check.status === "up");
  return { checks, status: allUp ? "ok" : "degraded" };
};
