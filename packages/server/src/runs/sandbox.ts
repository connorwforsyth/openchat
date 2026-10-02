import type { RunStart } from "@workspace/ai/ports/run-executor";
import { FRAGMENTS } from "@workspace/ai/prompts/generated";
import type { ToolAgent } from "@workspace/ai/tools/resolve";
import type { JsonValue } from "@workspace/contract/schemas/common";
import type { ApprovalDecision } from "@workspace/contract/schemas/message-parts";
import type { ProposedEdit } from "@workspace/contract/schemas/runs";
import type { SandboxProvider } from "@workspace/contract/schemas/sandbox";
import type { AsyncResult } from "@workspace/shared/result";
import type { Tool, ToolApprovalStatus } from "ai";
import { z } from "zod";

// Sandbox tools in a turn (D7, PLAN.md §11 M1 steps 6–7). Every chat has a
// workspace (its sandbox, "Files" in the UI), created on first use.
// `@workspace/sandbox` depends on this package, so it can't be imported
// here: the shell binds a `SandboxToolSource` (the sandbox package's
// `createTurnSandboxSource`) and the turn resolver asks it for the chat's
// tools. What stays here is the policy: which runs get them, and that
// `write`/`edit` ask by default, so every file change pauses the run with
// its proposed patch for per-hunk review (D16) unless the agent says
// otherwise.

/** The agent-facing sandbox tools, by the names agents list them under. */
export const SANDBOX_TOOLS = [
  "bash",
  "read",
  "write",
  "edit",
  "preview",
] as const;

/**
 * What a plain chat's model is told about its workspace. The user has no
 * terminal (D7), so a model that asks them to run something leaves them
 * stuck. The words are in `@workspace/ai`'s `prompts/fragments/workspace.md`.
 */
export const WORKSPACE_INSTRUCTIONS = FRAGMENTS.workspace.text;

/** Tools that change files: they ask unless the agent overrides them. */
export const FILE_CHANGE_TOOLS = ["write", "edit"] as const;

const isFileChange = (name: string): boolean =>
  (FILE_CHANGE_TOOLS as readonly string[]).includes(name);

/** A decision on a paused call, with the patch the reviewer saw. */
export interface ToolReview {
  readonly decision: ApprovalDecision;
  /** From the pending approval; a `review` decision's hunk ids refer to these. */
  readonly edits?: readonly ProposedEdit[];
}

/** Reviews by tool call id, for the pass that resumes after them. */
export type ToolReviews = ReadonlyMap<string, ToolReview>;

/** A paused call, as the proposal is asked for it. */
export interface PausedCall {
  readonly input: JsonValue;
  readonly toolName: string;
}

export const workspaceReadErrorSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("not_found") }),
  /** The workspace couldn't start, or the path is outside it. */
  z.object({ message: z.string(), type: z.literal("unavailable") }),
]);
export type WorkspaceReadError = z.infer<typeof workspaceReadErrorSchema>;

/** Reads a file from the chat's workspace, starting it if it must. */
export type WorkspaceRead = (
  path: string
) => AsyncResult<Uint8Array, WorkspaceReadError>;

/** Writes a file into the chat's workspace (an image, 138), starting it if it must. */
export type WorkspaceWrite = (
  path: string,
  bytes: Uint8Array
) => AsyncResult<void, { readonly message: string }>;

/** The chat's sandbox as one turn sees it. */
export interface TurnSandbox {
  /** What a paused call would change; `undefined` when it changes no file (or can't). */
  readonly proposeEdits: (
    call: PausedCall
  ) => Promise<readonly ProposedEdit[] | undefined>;
  /**
   * The provider a new workspace is asked for, or the attached one's. A new
   * one may still fall back to just-bash when this one's host is down.
   */
  readonly provider: SandboxProvider;
  /** For `@file` mentions (`workspace-context.ts`). */
  readonly readFile: WorkspaceRead;
  /** Keyed by the names in `SANDBOX_TOOLS`. */
  readonly tools: Readonly<Record<string, Tool>>;
  /** For files a tool makes itself, outside `write`'s review (`generate_image`). */
  readonly writeFile: WorkspaceWrite;
}

export interface SandboxToolRequest {
  /**
   * The agent version's provider, or `default` (the instance's) for a plain
   * chat, which always has a workspace unless the composer turned it off.
   * `null` asks only for a workspace that's already attached (an agent
   * without sandbox tools reading an `@file` mention). An attached
   * workspace always wins; it's the one the Files panel shows.
   */
  readonly requested: SandboxProvider | "default" | null;
  /** Decisions for the calls this pass executes (empty on a fresh turn). */
  readonly reviews: ToolReviews;
  readonly run: RunStart;
  readonly signal?: AbortSignal;
}

/** The shell's binding: the chat's sandbox tools, or `null` when there are none. */
export type SandboxToolSource = (
  request: SandboxToolRequest
) => Promise<TurnSandbox | null>;

/**
 * An agent with a sandbox as `resolveTools` should plan it: the sandbox it
 * actually got, every sandbox tool when it named none (a sandbox with no
 * tools to reach it is no use), and file changes asking unless the agent
 * set them to `auto` by name. Pure.
 */
export const withSandboxTools = <A extends ToolAgent>(
  agent: A,
  sandbox: Pick<TurnSandbox, "provider">
): A => {
  const named = agent.tools.some((name) =>
    (SANDBOX_TOOLS as readonly string[]).includes(name)
  );
  return {
    ...agent,
    approvals: {
      ...agent.approvals,
      tools: {
        ...Object.fromEntries(FILE_CHANGE_TOOLS.map((name) => [name, "ask"])),
        ...agent.approvals.tools,
      },
    },
    sandboxProvider: sandbox.provider,
    tools: named ? agent.tools : [...agent.tools, ...SANDBOX_TOOLS],
  };
};

/** A plain chat's approvals for its sandbox tools: file changes ask. */
export const chatSandboxApproval = (
  tools: Readonly<Record<string, Tool>>
): Record<string, ToolApprovalStatus> =>
  Object.fromEntries(
    Object.keys(tools).map((name) => [
      name,
      isFileChange(name) ? "user-approval" : "not-applicable",
    ])
  );
