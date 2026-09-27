import { z } from "zod";

// Health for compose healthchecks and load balancers (042). Any answer at
// all means the process is up (liveness); `status` says whether it can do
// its work (readiness): the database answers and the job queue runs. The
// app boots without either (AGENTS.md), so a degraded server still answers.

/** One dependency. `message` says why it's down, safe to show: never a URL or secret. */
export const healthCheckSchema = z.object({
  message: z.string().nullable(),
  status: z.enum(["up", "down"]),
});
export type HealthCheck = z.infer<typeof healthCheckSchema>;

export const healthSchema = z.object({
  checks: z.object({
    database: healthCheckSchema,
    jobs: healthCheckSchema,
  }),
  /** `ok` when every check is up. */
  status: z.enum(["ok", "degraded"]),
});
export type Health = z.infer<typeof healthSchema>;

export const healthInputSchema = z.object({
  /** Answer `NOT_READY` (503) instead of 200 when degraded, for probes that read only the status code. */
  ready: z.boolean().default(false),
});
