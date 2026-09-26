import type { SandboxId } from "@workspace/contract/schemas/common";
import type {
  ExecResult,
  FileEntry,
  SandboxRecord,
} from "@workspace/contract/schemas/sandbox";
import type { AsyncResult } from "@workspace/shared/result";

// What the sandbox panel needs from the outside world, as a port: the app
// implements it over the API client (the contract's `sandbox` group), the
// demo page over a just-bash sandbox in the browser. Errors are messages
// ready to show.

export interface OutputChunkLike {
  readonly data: string;
  readonly stream: "stdout" | "stderr";
}

export interface SandboxPanelClient {
  create: () => AsyncResult<SandboxRecord, string>;
  exec: (
    id: SandboxId,
    command: string,
    onOutput: (chunk: OutputChunkLike) => void
  ) => AsyncResult<ExecResult, string>;
  exposePort: (
    id: SandboxId,
    port: number
  ) => AsyncResult<{ readonly port: number; readonly url: string }, string>;
  listFiles: (id: SandboxId) => AsyncResult<readonly FileEntry[], string>;
  readFile: (
    id: SandboxId,
    path: string
  ) => AsyncResult<
    { readonly content: string; readonly encoding: "utf8" | "base64" },
    string
  >;
  reset: (id: SandboxId) => AsyncResult<SandboxRecord, string>;
}
