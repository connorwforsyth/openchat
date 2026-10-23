import { sandboxIdSchema } from "@workspace/contract/schemas/common";
import {
  execInputSchema,
  execResultSchema,
  fileEntrySchema,
  sandboxIsolationSchema,
  sandboxLimitsSchema,
  sandboxPathSchema,
  sandboxPreviewSchema,
  sandboxStatusSchema,
} from "@workspace/contract/schemas/sandbox";
import { z } from "zod";

import { sandboxErrorSchema } from "../ports/sandbox";
import { egressPolicySchema } from "./egress";

// The internal HTTP API between `web` (the docker provider in this package)
// and `apps/sandbox-runner` (D7). Both sides parse with these schemas, so a
// drift fails loudly at the boundary. Every request is HMAC-signed (see
// `auth.ts`); bodies are JSON, file bytes travel as base64, and `exec`
// streams NDJSON events so the panel's terminal sees output as it happens.

export const RUNNER_API_PREFIX = "/v1";

export const runnerRuntimeSchema = z.enum(["runsc", "runc"]);
export type RunnerRuntime = z.infer<typeof runnerRuntimeSchema>;

export const runnerStatusSchema = z.object({
  isolation: sandboxIsolationSchema,
  runtime: runnerRuntimeSchema,
  /** Live (not destroyed) sandboxes this runner manages. */
  sandboxes: z.int().min(0),
  /** Set when isolation is weaker than it should be; the admin UI shows it. */
  warning: z.string().nullable(),
});
export type RunnerStatus = z.infer<typeof runnerStatusSchema>;

/**
 * `workspace`: an idle container commands run in. `desktop`: the same, running
 * a graphical session an agent drives (a Dot's computer, 172).
 */
export const sandboxVariantSchema = z.enum(["workspace", "desktop"]);
export type SandboxVariant = z.infer<typeof sandboxVariantSchema>;

export const createRequestSchema = z.object({
  /** From `sandbox.egress`; `limits.network: false` still means `none`. */
  egress: egressPolicySchema.default({ mode: "none" }),
  id: sandboxIdSchema,
  limits: sandboxLimitsSchema,
  snapshotRef: z.string().min(1).max(256).optional(),
  variant: sandboxVariantSchema.default("workspace"),
});
export type CreateRequest = z.infer<typeof createRequestSchema>;

export const sandboxStateResponseSchema = z.object({
  id: sandboxIdSchema,
  status: sandboxStatusSchema,
});

export const execRequestSchema = execInputSchema;
export type ExecRequest = z.infer<typeof execRequestSchema>;

/** One line of the `exec` response stream. */
export const execEventSchema = z.discriminatedUnion("type", [
  z.object({
    data: z.string(),
    stream: z.enum(["stdout", "stderr"]),
    type: z.literal("output"),
  }),
  z.object({ result: execResultSchema, type: z.literal("exit") }),
  z.object({ error: sandboxErrorSchema, type: z.literal("error") }),
]);
export type ExecEvent = z.infer<typeof execEventSchema>;

export const listFilesQuerySchema = z.object({
  path: sandboxPathSchema.default("."),
  recursive: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
});

export const listFilesResponseSchema = z.object({
  entries: z.array(fileEntrySchema),
});

export const readFileQuerySchema = z.object({ path: sandboxPathSchema });

/** Largest file the runner moves in one request (before base64). */
export const MAX_FILE_BYTES = 16 * 1024 * 1024;

export const fileContentSchema = z.object({
  content: z.base64().max(Math.ceil(MAX_FILE_BYTES / 3) * 4),
});

export const writeFileRequestSchema = fileContentSchema.extend({
  path: sandboxPathSchema,
});

export const exposePortRequestSchema = z.object({
  port: z.int().min(1).max(65_535),
});
export const exposePortResponseSchema = sandboxPreviewSchema;

export const snapshotResponseSchema = z.object({ ref: z.string().min(1) });

/** Any non-2xx response carries the error as a value. */
export const errorResponseSchema = z.object({ error: sandboxErrorSchema });

export const runnerPaths = {
  exec: (id: string) => `${RUNNER_API_PREFIX}/sandboxes/${id}/exec`,
  file: (id: string) => `${RUNNER_API_PREFIX}/sandboxes/${id}/file`,
  files: (id: string) => `${RUNNER_API_PREFIX}/sandboxes/${id}/files`,
  ports: (id: string) => `${RUNNER_API_PREFIX}/sandboxes/${id}/ports`,
  restart: (id: string) => `${RUNNER_API_PREFIX}/sandboxes/${id}/restart`,
  sandbox: (id: string) => `${RUNNER_API_PREFIX}/sandboxes/${id}`,
  sandboxes: `${RUNNER_API_PREFIX}/sandboxes`,
  snapshot: (id: string) => `${RUNNER_API_PREFIX}/sandboxes/${id}/snapshot`,
  status: `${RUNNER_API_PREFIX}/status`,
} as const;

export const toBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  const chunk = 0x80_00;
  for (let start = 0; start < bytes.length; start += chunk) {
    binary += String.fromCharCode(...bytes.subarray(start, start + chunk));
  }
  return btoa(binary);
};

export const fromBase64 = (text: string): Uint8Array =>
  Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
