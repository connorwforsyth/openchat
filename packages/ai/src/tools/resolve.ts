import type { LibraryItemId } from "@workspace/contract/schemas/common";
import type { AgentDefinition } from "@workspace/contract/schemas/library";

// `resolveTools` (PLAN.md §8 step 3.2): which tools an agent version gets on
// this instance, for this user, with which approval mode. Pure; the tools
// themselves are built later by `buildToolSet`. A tool that can't be offered
// is skipped with a reason, never an error: a run without web search beats a
// run that fails.

/**
 * How a call proceeds: run it, ask a person first, or refuse it. Ordered
 * from loosest to strictest; combining modes always keeps the stricter one.
 */
export type ApprovalMode = "auto" | "ask" | "deny";

const RANK: Readonly<Record<ApprovalMode, number>> = {
  ask: 1,
  auto: 0,
  deny: 2,
};

/** The stricter of two modes. Rules and the Decider meet here (D15). */
export const stricter = (a: ApprovalMode, b: ApprovalMode): ApprovalMode =>
  RANK[b] > RANK[a] ? b : a;

export type ToolAgent = Pick<
  AgentDefinition,
  "approvals" | "mcpServers" | "sandboxProvider" | "tools"
>;

export interface ToolCapabilities {
  /** Tools the instance always asks about, whatever the agent says. */
  readonly alwaysAsk?: ReadonlySet<string>;
  /** Built-in tools this instance can serve right now (feature flags, backends, keys). */
  readonly builtins: ReadonlySet<string>;
  /** False for models without tool calling: the run gets no tools at all. */
  readonly modelSupportsTools: boolean;
  /** Built-ins that need a sandbox; dropped when the agent has none. */
  readonly sandboxTools?: ReadonlySet<string>;
}

export interface ToolGrants {
  /**
   * Tools the caller switched off (188), by server and the server's tool
   * name: left out of the plan's servers, whatever an agent lists.
   */
  readonly mcpExcludedTools?: ReadonlyMap<LibraryItemId, readonly string[]>;
  /** MCP servers the caller may `use` (ownership or a grant, D13). */
  readonly mcpServers: ReadonlySet<LibraryItemId>;
}

export type SkipReason =
  | "model_without_tools"
  | "unavailable"
  | "no_sandbox"
  | "not_granted";

export interface ToolPlan {
  /** Per-tool modes (agent overrides, tightened by the instance) and the default for the rest. */
  readonly approvals: {
    readonly default: ApprovalMode;
    readonly tools: Readonly<Record<string, ApprovalMode>>;
  };
  readonly builtins: readonly {
    readonly approval: ApprovalMode;
    readonly name: string;
  }[];
  readonly mcpServers: readonly {
    /** Tools to leave out (188), by the server's tool name. */
    readonly exclude?: readonly string[];
    readonly id: LibraryItemId;
    /** A subset of the server's tools; `undefined` means all of them. */
    readonly tools?: readonly string[];
  }[];
  readonly skipped: readonly {
    readonly name: string;
    readonly reason: SkipReason;
  }[];
}

/** A tool's mode under the plan, including MCP tools only known once listed. */
export const approvalFor = (
  plan: Pick<ToolPlan, "approvals">,
  toolName: string
): ApprovalMode => plan.approvals.tools[toolName] ?? plan.approvals.default;

export const resolveTools = (
  agent: ToolAgent,
  capabilities: ToolCapabilities,
  grants: ToolGrants
): ToolPlan => {
  const alwaysAsk = capabilities.alwaysAsk ?? new Set<string>();
  const names = new Set([...Object.keys(agent.approvals.tools), ...alwaysAsk]);
  const approvals: ToolPlan["approvals"] = {
    default: agent.approvals.default,
    tools: Object.fromEntries(
      [...names].map((name) => [
        name,
        stricter(
          agent.approvals.tools[name] ?? agent.approvals.default,
          alwaysAsk.has(name) ? "ask" : "auto"
        ),
      ])
    ),
  };

  if (!capabilities.modelSupportsTools) {
    return {
      approvals,
      builtins: [],
      mcpServers: [],
      skipped: [
        ...agent.tools.map((name) => ({
          name,
          reason: "model_without_tools" as const,
        })),
        ...agent.mcpServers.map((server) => ({
          name: server.id,
          reason: "model_without_tools" as const,
        })),
      ],
    };
  }

  const skipped: { name: string; reason: SkipReason }[] = [];
  const builtins: { approval: ApprovalMode; name: string }[] = [];
  for (const name of new Set(agent.tools)) {
    if (!capabilities.builtins.has(name)) {
      skipped.push({ name, reason: "unavailable" });
    } else if (
      agent.sandboxProvider === null &&
      capabilities.sandboxTools?.has(name)
    ) {
      skipped.push({ name, reason: "no_sandbox" });
    } else {
      builtins.push({ approval: approvalFor({ approvals }, name), name });
    }
  }

  const mcpServers = agent.mcpServers
    .filter((server) => {
      if (grants.mcpServers.has(server.id)) {
        return true;
      }
      skipped.push({ name: server.id, reason: "not_granted" });
      return false;
    })
    .map((server) => {
      const exclude = grants.mcpExcludedTools?.get(server.id);
      return exclude && exclude.length > 0 ? { ...server, exclude } : server;
    });

  return { approvals, builtins, mcpServers, skipped };
};
