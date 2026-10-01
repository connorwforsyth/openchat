import type {
  ToolContext,
  ToolEvent,
} from "@workspace/ai/tools/registry/define";
import type { ApprovalDecision } from "@workspace/contract/schemas/message-parts";
import type { ProposedEdit } from "@workspace/contract/schemas/runs";
import {
  type AsyncResult,
  err,
  ok,
  type Result,
} from "@workspace/shared/result";
import { z } from "zod";

import { resolveWorkspacePath, WORKDIR } from "../paths";
import type { OutputChunk, Sandbox, SandboxError } from "../ports/sandbox";

// The agent's sandbox tools (D7) over any `Sandbox`: `bash`, `read`, `write`,
// `edit` and `preview`. The user calls the sandbox the chat's workspace and
// sees its files in the Files panel, so the descriptions say so. `write`
// and `edit` never touch the file blindly: each computes a `ProposedEdit`
// first, and in `ask` mode the run executor shows it for per-hunk review
// (D16) and hands the decision back through `reviewFor`; only accepted
// hunks are applied. The proposal carries a hash of the file it was made
// from, so a file the user edited while the change waited isn't
// overwritten. Expected failures come back as `{ status: "error" }` outputs
// the model can read, not throws.
//
// `read`, `write` and `edit` only touch files inside `/work` (D7), by the
// same rule as the Files panel's routes (`resolveWorkspacePath`); anywhere
// else is an error the model can correct. `bash` isn't held to it: the
// sandbox itself is its boundary.
//
// This module is what the five tools share: the workspace a run binds them
// to, and how they read a file from it. Each tool is written down in its
// own file in `defs/` (080).

/** A decision on a write/edit call, with the proposal the reviewer saw. */
export interface Review {
  readonly decision: ApprovalDecision;
  /** When given, the file must still produce this exact patch. */
  readonly proposed?: ProposedEdit;
}

/** Looks up the review of a call; `undefined` means it ran without one. */
export type ReviewLookup = (
  toolCallId: string
) => Review | undefined | Promise<Review | undefined>;

/** The part of a `Sandbox` the tools use; a lazily started sandbox can stand in. */
export type ToolSandbox = Pick<
  Sandbox,
  "exec" | "exposePort" | "readFile" | "writeFile"
>;

/**
 * The chat's workspace as one run's tools reach it: the `workspace` part of
 * their context.
 */
export interface SandboxWorkspace {
  /**
   * Called once a `write` or `edit` has landed (some of it applied), with
   * the path it was given; the static preview (067) hangs off it. It must
   * not fail: the change is already made.
   */
  readonly onChanged?: (path: string) => Promise<void>;
  readonly reviewFor?: ReviewLookup;
  readonly sandbox: ToolSandbox;
  /** Waits between listener probes; tests pass one that doesn't. */
  readonly sleep?: (ms: number) => Promise<void>;
}

/** `bash` output as it arrives, for the panel. */
export interface BashOutputEvent extends ToolEvent {
  readonly chunk: OutputChunk;
  readonly type: "output";
}

/** What a run binds the sandbox tools to. */
export interface SandboxToolRun {
  readonly emit?: (event: BashOutputEvent) => void;
  readonly workspace: SandboxWorkspace;
}

/** What a sandbox tool's `execute` gets. */
export type SandboxToolContext = ToolContext<SandboxToolRun>;

export const toolErrorSchema = z.object({
  message: z.string(),
  status: z.literal("error"),
});

export const describeError = (error: SandboxError): string => {
  switch (error.type) {
    case "not_found":
      return `${error.path}: no such file or directory`;
    case "invalid_path":
      return `${error.path}: path is outside the workspace`;
    case "destroyed":
      return "The workspace was reset and its files are gone; try again to use the new one.";
    case "unsupported":
      return error.operation === "exposePort"
        ? "This workspace can't serve previews; previews need a Docker workspace."
        : `This workspace doesn't support ${error.operation}.`;
    case "limit_exceeded":
      return `Workspace limit reached: ${error.message}`;
    case "unavailable":
      return `The workspace is unavailable: ${error.message}`;
    default:
      return error satisfies never;
  }
};

export const failure = (message: string) => ({
  message,
  status: "error" as const,
});

/**
 * The workspace file a tool's `path` names, as an absolute path under
 * `/work`, or a message saying how to name one. The model's own spelling
 * stays in what it's shown (proposals, errors); the sandbox only ever gets
 * the checked path.
 */
const workspaceFile = (path: string): Result<string, string> => {
  const resolved = resolveWorkspacePath(path);
  return resolved.ok
    ? resolved
    : err(
        `${resolved.error.message} Paths must be inside ${WORKDIR}; relative paths resolve against it.`
      );
};

const decoder = new TextDecoder("utf-8", { fatal: true });

/**
 * The workspace file `path` names, as text: missing is empty (for `write`),
 * binary or outside `/work` is an error. Also returns the checked path.
 */
export const readText = async (
  sandbox: ToolSandbox,
  path: string,
  { missingIsEmpty }: { readonly missingIsEmpty: boolean }
): AsyncResult<{ target: string; text: string }, string> => {
  const target = workspaceFile(path);
  if (!target.ok) {
    return target;
  }
  const read = await sandbox.readFile(target.value);
  if (!read.ok) {
    if (read.error.type !== "not_found") {
      return err(describeError(read.error));
    }
    return missingIsEmpty
      ? ok({ target: target.value, text: "" })
      : err(describeError({ ...read.error, path }));
  }
  try {
    return ok({ target: target.value, text: decoder.decode(read.value) });
  } catch {
    return err(`${path} is not a UTF-8 text file`);
  }
};

/** Pages written with `write` or `edit` preview without a server of the agent's own. */
export const STATIC_PREVIEW_NOTE = `Writing an .html file shows it in the user's Preview panel on its own; plain HTML, CSS and JS need no server.`;
