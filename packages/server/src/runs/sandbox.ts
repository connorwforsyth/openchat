import type { RunStart } from "@workspace/ai/ports/run-executor";
import type { ToolAgent } from "@workspace/ai/tools/resolve";
import type { JsonValue } from "@workspace/contract/schemas/common";
import type { ApprovalDecision } from "@workspace/contract/schemas/message-parts";
import type { ProposedEdit } from "@workspace/contract/schemas/runs";
import type { SandboxProvider } from "@workspace/contract/schemas/sandbox";
import type { Tool, ToolApprovalStatus } from "ai";

// Sandbox tools in a turn (D7, PLAN.md §11 M1 steps 6–7). `@workspace/sandbox`
// depends on this package, so it can't be imported here: the shell binds a
// `SandboxToolSource` (the sandbox package's `createTurnSandboxSource`) and
// the turn resolver asks it for the chat's tools. What stays here is the
// policy: which runs get them, and that `write`/`edit` ask by default, so
// every file change pauses the run with its proposed patch for per-hunk
// review (D16) unless the agent says otherwise.

/** The agent-facing sandbox tools, by the names agents list them under. */
export const SANDBOX_TOOLS = [
  "bash",
  "read",
  "write",
  "edit",
  "preview",
] as const;

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

/** The chat's sandbox as one turn sees it. */
export interface TurnSandbox {
  /** What a paused call would change; `undefined` when it changes no file (or can't). */
  readonly proposeEdits: (
    call: PausedCall
  ) => Promise<readonly ProposedEdit[] | undefined>;
  readonly provider: SandboxProvider;
  /** Keyed by the names in `SANDBOX_TOOLS`. */
  readonly tools: Readonly<Record<string, Tool>>;
}

export interface SandboxToolRequest {
  /**
   * The agent version's provider, or `default` (the instance's) when the
   * composer turned the sandbox on for a plain chat. `null` for a plain
   * chat otherwise: it gets tools only when a sandbox is already attached.
   * An attached sandbox always wins; it's the one the panel shows.
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
