import type { LibraryItemId } from "@workspace/contract/schemas/common";
import { jsonValueSchema } from "@workspace/contract/schemas/common";
import { toolNameSchema } from "@workspace/contract/schemas/message-parts";
import type { AsyncResult } from "@workspace/shared/result";
import {
  jsonSchema,
  type Tool,
  type ToolApprovalStatus,
  type ToolSet,
  tool,
} from "ai";
import { z } from "zod";

import { type ApprovalMode, approvalFor, type ToolPlan } from "./resolve";

// The tool registry: one AI SDK `ToolSet` for a run, merged from
// - server tools (built-ins with `execute`: web search, file search, sandbox,
//   memory; each workstream builds its own and hands them in),
// - client tools (no `execute`: the run stops at the call and a client
//   supplies the output, as desktop cowork and UI prompts do),
// - MCP tools (ticket 018 fills `McpToolSource` over `@ai-sdk/mcp`).
// Names are unique across the set; a later source never shadows an earlier one.

export const clientToolSchema = z.object({
  description: z.string().max(10_000).optional(),
  /** JSON Schema (draft 7) for the input. */
  inputSchema: z.record(z.string(), jsonValueSchema),
  name: toolNameSchema,
});
export type ClientTool = z.infer<typeof clientToolSchema>;

export const mcpToolErrorSchema = z.object({
  message: z.string(),
  type: z.enum(["unavailable", "unauthorized"]),
});
export type McpToolError = z.infer<typeof mcpToolErrorSchema>;

/** The port 018 implements: a server's tools, keyed by the name the model sees. */
export interface McpToolSource {
  tools: (
    server: { readonly id: LibraryItemId; readonly tools?: readonly string[] },
    options?: { readonly signal?: AbortSignal }
  ) => AsyncResult<ToolSet, McpToolError>;
}

export interface ToolSources {
  readonly builtins: Readonly<Record<string, Tool>>;
  readonly client?: readonly ClientTool[];
  readonly mcp?: McpToolSource;
}

export type ToolSetSkipReason =
  | "denied"
  | "duplicate"
  | "mcp_unavailable"
  | "unavailable";

export interface BuiltToolSet {
  readonly skipped: readonly {
    readonly name: string;
    readonly reason: ToolSetSkipReason;
  }[];
  /** For `ToolLoopAgent`'s `toolApproval`. */
  readonly toolApproval: Readonly<Record<string, ToolApprovalStatus>>;
  readonly tools: ToolSet;
}

const toStatus = (mode: Exclude<ApprovalMode, "deny">): ToolApprovalStatus =>
  mode === "ask" ? "user-approval" : "not-applicable";

export const clientTool = ({ description, inputSchema }: ClientTool): Tool =>
  tool({ description, inputSchema: jsonSchema(inputSchema) });

export const buildToolSet = async (
  plan: ToolPlan,
  sources: ToolSources,
  options: { readonly signal?: AbortSignal } = {}
): Promise<BuiltToolSet> => {
  const tools: Record<string, Tool> = {};
  const toolApproval: Record<string, ToolApprovalStatus> = {};
  const skipped: { name: string; reason: ToolSetSkipReason }[] = [];

  const add = (name: string, value: Tool, mode: ApprovalMode) => {
    if (tools[name]) {
      skipped.push({ name, reason: "duplicate" });
    } else if (mode === "deny") {
      // Not offered at all: cheaper than letting the model call it to be refused.
      skipped.push({ name, reason: "denied" });
    } else {
      tools[name] = value;
      toolApproval[name] = toStatus(mode);
    }
  };

  for (const { approval, name } of plan.builtins) {
    const builtin = sources.builtins[name];
    if (builtin) {
      add(name, builtin, approval);
    } else {
      skipped.push({ name, reason: "unavailable" });
    }
  }
  // The client decides for itself whether to ask before acting.
  for (const definition of sources.client ?? []) {
    add(definition.name, clientTool(definition), "auto");
  }

  const { mcp } = sources;
  const listed = mcp
    ? await Promise.all(
        plan.mcpServers.map(async (server) => ({
          result: await mcp.tools(server, options),
          server,
        }))
      )
    : [];
  for (const { result, server } of listed) {
    if (!result.ok) {
      // One broken MCP server shouldn't take the run down with it.
      skipped.push({ name: server.id, reason: "mcp_unavailable" });
      continue;
    }
    for (const [name, value] of Object.entries(result.value)) {
      add(name, value, approvalFor(plan, name));
    }
  }
  if (!mcp) {
    for (const server of plan.mcpServers) {
      skipped.push({ name: server.id, reason: "mcp_unavailable" });
    }
  }

  return { skipped, toolApproval, tools };
};
