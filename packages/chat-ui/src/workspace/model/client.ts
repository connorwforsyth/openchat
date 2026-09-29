import type { SandboxId } from "@workspace/contract/schemas/common";
import type {
  FileEntry,
  SandboxFileEncoding,
  SandboxFileEtag,
  SandboxFileWrite,
  SandboxRecord,
} from "@workspace/contract/schemas/sandbox";
import type { AsyncResult } from "@workspace/shared/result";

// What the Workspace panel needs from the outside world, as a port: the app
// implements it over the API client (the contract's `sandbox` group, which
// keeps its name; "Workspace" is only what the UI calls it), the demo pages
// over a just-bash sandbox in the browser. Writes, imports and deletes are
// the chat's, not a sandbox id's: each creates the workspace on first use.
// Paths are absolute (`/work/a.ts`). Errors are messages ready to show,
// except a write's conflicts, which the editor reacts to.

export interface WorkspaceFileRead {
  readonly content: string;
  readonly encoding: SandboxFileEncoding;
  /** Pass back as `ifMatch` to save over this version only. */
  readonly etag: SandboxFileEtag;
  /** Bytes, decoded. */
  readonly size: number;
}

export interface WorkspaceWriteInput {
  readonly content: string;
  /** The version being replaced; `null` only creates; omitted overwrites. */
  readonly ifMatch?: SandboxFileEtag | null;
  readonly path: string;
}

/** Why a write failed: someone else's change, a taken name, or anything else. */
export type WorkspaceWriteError =
  | { readonly kind: "version_mismatch" }
  | { readonly kind: "already_exists" }
  | { readonly kind: "failed"; readonly message: string };

export interface WorkspaceClient {
  deleteFile: (path: string) => AsyncResult<void, string>;
  /** Uploads `file` and copies it into the workspace, under a free name. */
  importFile: (file: File) => AsyncResult<SandboxFileWrite, string>;
  listFiles: (id: SandboxId) => AsyncResult<readonly FileEntry[], string>;
  readFile: (
    id: SandboxId,
    path: string
  ) => AsyncResult<WorkspaceFileRead, string>;
  /** Empties the workspace and starts it again. */
  reset: (id: SandboxId) => AsyncResult<SandboxRecord, string>;
  writeFile: (
    input: WorkspaceWriteInput
  ) => AsyncResult<SandboxFileWrite, WorkspaceWriteError>;
}

/**
 * Where the panel's files come from: nowhere when sandboxes are off on this
 * instance; nowhere yet for a chat that hasn't been created (its first
 * message creates it); otherwise the chat's workspace.
 */
export type WorkspaceFilesSource =
  | { readonly kind: "off" }
  | { readonly kind: "new-chat" }
  | {
      readonly client: WorkspaceClient;
      readonly kind: "chat";
      /** Refetch `sandbox.get`: something the panel did changed the workspace. */
      readonly onChanged: () => void;
      /**
       * The chat's workspace, straight from the `sandbox.get` query (the one
       * source of truth); `null` before its first use creates it.
       */
      readonly sandbox: SandboxRecord | null;
    };
