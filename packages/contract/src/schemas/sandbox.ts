import { z } from "zod";

import {
  conversationIdSchema,
  sandboxIdSchema,
  timestampSchema,
} from "./common";

// Sandboxes (D7). One per conversation at most. `just-bash` is simulated (no
// processes); `docker` runs behind `sandbox-runner`; `local` is the desktop
// cowork workspace. The `Sandbox` port lives in `@workspace/sandbox`.

export const sandboxProviderSchema = z.enum([
  "just-bash",
  "docker",
  "e2b",
  "vercel",
  "microsandbox",
  "local",
]);
export type SandboxProvider = z.infer<typeof sandboxProviderSchema>;

/**
 * How strongly the sandbox is isolated, shown in the panel and admin UI:
 * `gvisor` (runsc), `container` (plain Docker, with a warning), `vm` (remote
 * microVMs), `simulated` (just-bash) or `none` (desktop local).
 */
export const sandboxIsolationSchema = z.enum([
  "gvisor",
  "container",
  "vm",
  "simulated",
  "none",
]);

export const sandboxStatusSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("provisioning") }),
  z.object({ state: z.literal("ready") }),
  /** Stopped to save resources; resumes from its volume or snapshot. */
  z.object({ state: z.literal("stopped") }),
  z.object({ message: z.string(), state: z.literal("failed") }),
  z.object({ state: z.literal("destroyed") }),
]);
export type SandboxStatus = z.infer<typeof sandboxStatusSchema>;
export type SandboxState = SandboxStatus["state"];

export const sandboxLimitsSchema = z.object({
  cpu: z.number().positive().max(64),
  diskMb: z.int().min(1).nullable(),
  memoryMb: z.int().min(1),
  /** Whether outbound network is allowed at all; finer policy is the runner's. */
  network: z.boolean(),
});
export type SandboxLimits = z.infer<typeof sandboxLimitsSchema>;

/** A port exposed for the web preview. Served from the sandbox origin, never the app's. */
export const sandboxPreviewSchema = z.object({
  port: z.int().min(1).max(65_535),
  url: z.url(),
});

export const sandboxSchema = z.object({
  conversationId: conversationIdSchema,
  createdAt: timestampSchema,
  id: sandboxIdSchema,
  isolation: sandboxIsolationSchema,
  limits: sandboxLimitsSchema,
  previews: z.array(sandboxPreviewSchema),
  provider: sandboxProviderSchema,
  /** The latest snapshot, if any; `reset` restores from nothing, not from this. */
  snapshotRef: z.string().nullable(),
  status: sandboxStatusSchema,
  updatedAt: timestampSchema,
});
export type SandboxRecord = z.infer<typeof sandboxSchema>;

/** Paths are POSIX, absolute or relative to the sandbox workdir. */
export const sandboxPathSchema = z.string().min(1).max(4096);

export const execInputSchema = z.object({
  command: z.string().min(1).max(100_000),
  cwd: sandboxPathSchema.optional(),
  env: z.record(z.string(), z.string()).optional(),
  timeoutMs: z.int().min(1).max(3_600_000).optional(),
});
export type ExecInput = z.infer<typeof execInputSchema>;

export const execResultSchema = z.object({
  durationMs: z.int().min(0),
  exitCode: z.int(),
  stderr: z.string(),
  stdout: z.string(),
  timedOut: z.boolean(),
  /** Output past the provider's cap was dropped. */
  truncated: z.boolean(),
});
export type ExecResult = z.infer<typeof execResultSchema>;

export const fileEntrySchema = z.object({
  modifiedAt: timestampSchema.nullable(),
  path: sandboxPathSchema,
  size: z.int().min(0).nullable(),
  type: z.enum(["file", "directory", "symlink"]),
});
export type FileEntry = z.infer<typeof fileEntrySchema>;
