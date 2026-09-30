import { jsonSchema, type Tool } from "ai";

import type { ClientTool } from "../tool-set";
import type { ToolDefinition } from "./define";

// Tools we don't write, in the registry's shape, so a tool set is made of
// one kind of thing whatever its source.

/**
 * A client tool (desktop cowork, UI prompts): no `execute`, so the run
 * stops at the call and the client supplies the output. The client decides
 * for itself whether to ask before acting, so ours never does.
 */
export const clientToolDefinition = ({
  description,
  inputSchema,
  name,
}: ClientTool): ToolDefinition => ({
  approval: "auto",
  description,
  input: jsonSchema(inputSchema),
  name,
  source: "client",
});

/**
 * An MCP tool under the name the model sees (`server__tool`). `@ai-sdk/mcp`
 * already built it, with the server's schema and its own call handling, so
 * it's kept whole and handed back as it is. Nobody vetted a server's tools,
 * so they ask unless an agent's author says otherwise.
 */
export const mcpToolDefinition = (
  name: string,
  tool: Tool
): ToolDefinition => ({
  approval: "ask",
  description:
    typeof tool.description === "string" ? tool.description : undefined,
  input: tool.inputSchema,
  name,
  sdkTool: tool,
  source: "mcp",
});
