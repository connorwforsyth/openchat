import type {
  ConversationId,
  SandboxId,
} from "@workspace/contract/schemas/common";
import type {
  ExecResult,
  FileEntry,
  SandboxLimits,
  SandboxProvider,
  SandboxStatus,
} from "@workspace/contract/schemas/sandbox";
import type { AsyncResult } from "@workspace/shared/result";
import { z } from "zod";

// The Sandbox port (D7). One interface over just-bash (simulated, in-process),
// Docker via `sandbox-runner`, and remote providers. The agent's `bash`,
// `read`, `write`, `edit` and `preview` tools and the in-chat panel both go
// through it. Paths are POSIX; relative ones resolve against the workdir.

export const sandboxErrorSchema = z.discriminatedUnion("type", [
  z.object({ path: z.string(), type: z.literal("not_found") }),
  /** Outside the sandbox root, or otherwise malformed. */
  z.object({ path: z.string(), type: z.literal("invalid_path") }),
  z.object({ type: z.literal("destroyed") }),
  /** The provider can't do this (just-bash has no ports to expose). */
  z.object({ operation: z.string(), type: z.literal("unsupported") }),
  z.object({ message: z.string(), type: z.literal("limit_exceeded") }),
  z.object({ message: z.string(), type: z.literal("unavailable") }),
]);
export type SandboxError = z.infer<typeof sandboxErrorSchema>;

export interface OutputChunk {
  readonly data: string;
  readonly stream: "stdout" | "stderr";
}

export interface ExecOptions {
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  /** Streams output as it arrives, for the panel's terminal. */
  readonly onOutput?: (chunk: OutputChunk) => void;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

/**
 * A running sandbox. A non-zero exit code is a successful `exec` (the
 * command ran); errors are for when it couldn't run at all.
 */
export interface Sandbox {
  /** Removes the sandbox and its volume. Later calls return `destroyed`. */
  destroy: () => AsyncResult<void, SandboxError>;
  exec: (
    command: string,
    options?: ExecOptions
  ) => AsyncResult<ExecResult, SandboxError>;
  /** Serves `port` on the sandbox preview origin (never the app's origin, D24). */
  exposePort: (
    port: number
  ) => AsyncResult<
    { readonly port: number; readonly url: string },
    SandboxError
  >;
  readonly id: SandboxId;
  listFiles: (
    path: string,
    options?: { readonly recursive?: boolean }
  ) => AsyncResult<readonly FileEntry[], SandboxError>;
  readonly provider: SandboxProvider;
  readFile: (path: string) => AsyncResult<Uint8Array, SandboxError>;
  /** A restorable copy of the filesystem; pass `ref` to `create` to restore. */
  snapshot: () => AsyncResult<{ readonly ref: string }, SandboxError>;
  status: () => AsyncResult<SandboxStatus, SandboxError>;
  /** Creates parent directories as needed. */
  writeFile: (
    path: string,
    content: Uint8Array | string
  ) => AsyncResult<void, SandboxError>;
}

export interface CreateSandboxSpec {
  readonly conversationId: ConversationId;
  readonly id: SandboxId;
  readonly limits: SandboxLimits;
  /** Restore from a snapshot instead of starting empty. */
  readonly snapshotRef?: string;
}

/** Creates sandboxes for one provider, and reattaches to ones that survived a restart. */
export interface SandboxFactory {
  attach: (id: SandboxId) => AsyncResult<Sandbox, SandboxError>;
  create: (spec: CreateSandboxSpec) => AsyncResult<Sandbox, SandboxError>;
  readonly provider: SandboxProvider;
}
