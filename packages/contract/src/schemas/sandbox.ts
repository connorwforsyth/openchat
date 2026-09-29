import { z } from "zod";

import {
  conversationIdSchema,
  fileIdSchema,
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

// The chat's Files workspace (055). The UI calls the sandbox a workspace; the
// routes keep the `sandbox` name. Writes, imports and deletes are keyed by
// conversation, not sandbox id, because each one creates the workspace on
// first use: the composer and panel never have to create it first.

/** Text as UTF-8, anything else as base64 (both ways: reads and writes). */
export const sandboxFileEncodingSchema = z.enum(["utf8", "base64"]);
export type SandboxFileEncoding = z.infer<typeof sandboxFileEncodingSchema>;

/**
 * A file's version: the lowercase hex SHA-256 of its bytes. `readFile`
 * returns it and `writeFile` takes it back as `ifMatch`, so an editor can't
 * overwrite a change the agent (or another tab) made since it read.
 */
export const sandboxFileEtagSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "lowercase hex SHA-256");
export type SandboxFileEtag = z.infer<typeof sandboxFileEtagSchema>;

/**
 * The most a `writeFile` can carry, decoded (5 MiB). It's a JSON body, so
 * anything bigger goes through `files.upload` and `importFile` instead.
 */
export const SANDBOX_WRITE_MAX_BYTES = 5 * 1024 * 1024;

/** Base64 of `SANDBOX_WRITE_MAX_BYTES`: the longest `content` can be, before decoding. */
const maxContentLength = Math.ceil(SANDBOX_WRITE_MAX_BYTES / 3) * 4;

const utf8 = new TextEncoder();
const base64 = z.base64();

/** Decoded size in bytes, or `null` when base64 content isn't base64. */
const decodedBytes = (
  content: string,
  encoding: SandboxFileEncoding
): number | null => {
  if (encoding === "utf8") {
    return utf8.encode(content).byteLength;
  }
  if (!base64.safeParse(content).success) {
    return null;
  }
  const padding = content.endsWith("==") ? 2 : Number(content.endsWith("="));
  return (content.length / 4) * 3 - padding;
};

/**
 * Write a whole file, creating parent directories. `ifMatch` omitted
 * overwrites whatever is there; `null` only creates (`CONFLICT`
 * `already_exists` if the path exists); an etag only replaces that version
 * (`CONFLICT` `version_mismatch` if the file changed or is gone).
 */
export const writeFileInputSchema = z
  .object({
    content: z.string().max(maxContentLength),
    conversationId: conversationIdSchema,
    encoding: sandboxFileEncodingSchema.default("utf8"),
    ifMatch: sandboxFileEtagSchema.nullable().optional(),
    path: sandboxPathSchema,
  })
  .superRefine(({ content, encoding }, ctx) => {
    const bytes = decodedBytes(content, encoding);
    if (bytes === null) {
      ctx.addIssue({
        code: "custom",
        message: "Not valid base64.",
        path: ["content"],
      });
    } else if (bytes > SANDBOX_WRITE_MAX_BYTES) {
      ctx.addIssue({
        code: "custom",
        message: `Larger than ${SANDBOX_WRITE_MAX_BYTES} bytes; upload it and import it instead.`,
        path: ["content"],
      });
    }
  });
export type WriteFileInput = z.infer<typeof writeFileInputSchema>;

/** Where a write or import landed, and the version it made. */
export const sandboxFileWriteSchema = z.object({
  etag: sandboxFileEtagSchema,
  path: sandboxPathSchema,
  size: z.int().min(0),
});
export type SandboxFileWrite = z.infer<typeof sandboxFileWriteSchema>;

/**
 * Copy an uploaded file (`files.upload`) into the workspace. `path` omitted
 * is the upload's name in the workdir. A taken path isn't a conflict: the
 * copy gets a free name beside it (`notes (2).md`), returned in the output.
 */
export const importFileInputSchema = z.object({
  conversationId: conversationIdSchema,
  fileId: fileIdSchema,
  path: sandboxPathSchema.optional(),
});
export type ImportFileInput = z.infer<typeof importFileInputSchema>;

/**
 * Delete a file or directory. A directory with anything in it needs
 * `recursive` (`CONFLICT` `not_empty` without it), so a stray click can't
 * empty a folder.
 */
export const deleteFileInputSchema = z.object({
  conversationId: conversationIdSchema,
  path: sandboxPathSchema,
  recursive: z.boolean().default(false),
});
export type DeleteFileInput = z.infer<typeof deleteFileInputSchema>;
