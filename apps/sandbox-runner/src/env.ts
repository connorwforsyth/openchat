import { z } from "zod";

// The runner's settings, all from the environment and all optional: with
// nothing set it still boots, reports itself unconfigured and refuses API
// calls until SANDBOX_RUNNER_TOKEN is set (see `.env.example`).

/** Compose passes unset variables as `""`; treat that as unset. */
const unsetIfEmpty = <S extends z.ZodType>(schema: S) =>
  z.preprocess(
    (value) => (value === "" ? undefined : value),
    schema.optional()
  );

export const envSchema = z.object({
  /** The proxy in front of the Docker socket, never the socket itself (D24). */
  DOCKER_HOST: z.string().default("tcp://docker-socket-proxy:2375"),
  /** This runner's container, joined to sandbox networks to reach previews. */
  RUNNER_CONTAINER: unsetIfEmpty(z.string().min(1)),
  /**
   * The forward proxy `allowlist` sandboxes reach the internet through, on
   * the sandbox networks only (never published). Egress policy itself comes
   * with each create request, from `sandbox.egress` in app.config.yaml.
   */
  RUNNER_EGRESS_PROXY_PORT: z.coerce
    .number()
    .int()
    .min(1)
    .max(65_535)
    .default(3128),
  RUNNER_HOST: z.string().default("0.0.0.0"),
  RUNNER_PORT: z.coerce.number().int().min(1).max(65_535).default(7070),
  RUNNER_PREVIEW_PORT: z.coerce.number().int().min(1).max(65_535).default(7071),
  /** The image `desktop` sandboxes run (a Dot's computer, 172); built from `apps/sandbox-runner/desktop`. */
  SANDBOX_DESKTOP_IMAGE: z.string().min(1).default("sandbox-desktop:latest"),
  SANDBOX_IDLE_MINUTES: z.coerce.number().int().min(1).default(30),
  SANDBOX_IMAGE: z.string().min(1).default("node:24-bookworm-slim"),
  SANDBOX_PIDS_LIMIT: z.coerce.number().int().min(16).default(512),
  /** e.g. `http://{id}-{port}.sandbox.localhost:7071`; empty turns previews off. */
  SANDBOX_PREVIEW_URL: z
    .string()
    .default("http://{id}-{port}.sandbox.localhost:7071"),
  SANDBOX_RUNNER_TOKEN: unsetIfEmpty(z.string().min(1)),
  /** `auto` prefers gVisor; `runsc` fails closed without it; `runc` forces plain Docker. */
  SANDBOX_RUNTIME: z.enum(["auto", "runsc", "runc"]).default("auto"),
  /** Cap each sandbox's writable layer with `StorageOpt` (overlay2 on xfs + pquota only). */
  SANDBOX_STORAGE_QUOTA: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  SANDBOX_TMP_MB: z.coerce.number().int().min(16).default(512),
  SANDBOX_USER: z
    .string()
    .regex(/^[1-9]\d*:[1-9]\d*$/, "a non-root uid:gid")
    .default("1000:1000"),
});
export type RunnerEnv = z.infer<typeof envSchema>;
