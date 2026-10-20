import { agentDefinitionSchema } from "@workspace/contract/schemas/library";
import { newId } from "@workspace/shared/ids";
import { err, ok } from "@workspace/shared/result";
import { tool } from "ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  type ApprovalMode,
  approvalFor,
  resolveTools,
  stricter,
} from "./resolve";
import { buildToolSet, type McpToolSource } from "./tool-set";

const agent = (input: object = {}) =>
  agentDefinitionSchema.parse({
    instructions: "",
    kind: "agent",
    model: "fast",
    ...input,
  });

const echo = tool({
  execute: ({ text }) => text,
  inputSchema: z.object({ text: z.string() }),
});

const docsServer = newId("libraryItem");
const secretServer = newId("libraryItem");

describe("stricter", () => {
  const modes: ApprovalMode[] = ["auto", "ask", "deny"];
  it.each(modes.flatMap((a) => modes.map((b) => [a, b] as const)))(
    "%s + %s never loosens either side",
    (a, b) => {
      const combined = stricter(a, b);
      expect(modes.indexOf(combined)).toBe(
        Math.max(modes.indexOf(a), modes.indexOf(b))
      );
    }
  );
});

describe("resolveTools", () => {
  const capabilities = {
    alwaysAsk: new Set(["bash"]),
    builtins: new Set(["web_search", "bash"]),
    modelSupportsTools: true,
    sandboxTools: new Set(["bash"]),
  };

  it("leaves out the tools the caller switched off, server by server (188)", () => {
    const plan = resolveTools(
      agent({
        mcpServers: [{ id: docsServer }, { id: secretServer, tools: ["read"] }],
      }),
      capabilities,
      {
        mcpExcludedTools: new Map([
          [docsServer, ["delete_page"]],
          [secretServer, []],
        ]),
        mcpServers: new Set([docsServer, secretServer]),
      }
    );
    expect(plan.mcpServers).toEqual([
      { exclude: ["delete_page"], id: docsServer },
      { id: secretServer, tools: ["read"] },
    ]);
  });

  it("offers what's available and granted, and says why the rest isn't", () => {
    const plan = resolveTools(
      agent({
        mcpServers: [{ id: docsServer }, { id: secretServer, tools: ["read"] }],
        sandboxProvider: "just-bash",
        tools: ["web_search", "file_search", "bash"],
      }),
      capabilities,
      { mcpServers: new Set([docsServer]) }
    );
    expect(plan.builtins).toEqual([
      { approval: "auto", name: "web_search" },
      { approval: "ask", name: "bash" },
    ]);
    expect(plan.mcpServers).toEqual([{ id: docsServer }]);
    expect(plan.skipped).toEqual([
      { name: "file_search", reason: "unavailable" },
      { name: secretServer, reason: "not_granted" },
    ]);
  });

  it("drops sandbox tools from an agent without a sandbox", () => {
    const plan = resolveTools(agent({ tools: ["bash"] }), capabilities, {
      mcpServers: new Set(),
    });
    expect(plan.skipped).toEqual([{ name: "bash", reason: "no_sandbox" }]);
  });

  it("gives a model without tool calling nothing", () => {
    const plan = resolveTools(
      agent({ mcpServers: [{ id: docsServer }], tools: ["web_search"] }),
      { ...capabilities, modelSupportsTools: false },
      { mcpServers: new Set([docsServer]) }
    );
    expect(plan.builtins).toEqual([]);
    expect(plan.mcpServers).toEqual([]);
    expect(plan.skipped.map((s) => s.reason)).toEqual([
      "model_without_tools",
      "model_without_tools",
    ]);
  });

  it("lets the agent ask more but never less than the instance", () => {
    const plan = resolveTools(
      agent({
        approvals: {
          default: "ask",
          tools: { bash: "auto", web_search: "auto" },
        },
      }),
      capabilities,
      { mcpServers: new Set() }
    );
    expect(approvalFor(plan, "bash")).toBe("ask");
    expect(approvalFor(plan, "web_search")).toBe("auto");
    expect(approvalFor(plan, "mcp_unknown")).toBe("ask");
  });
});

describe("buildToolSet", () => {
  const mcp: McpToolSource = {
    tools: (server) =>
      Promise.resolve(
        server.id === docsServer
          ? ok({ docs_search: echo, echo })
          : err({ message: "down", type: "unavailable" as const })
      ),
  };

  it("merges server, client and MCP tools with approvals", async () => {
    const plan = resolveTools(
      agent({
        approvals: { default: "auto", tools: { docs_search: "ask" } },
        mcpServers: [{ id: docsServer }, { id: secretServer }],
        tools: ["echo"],
      }),
      { builtins: new Set(["echo"]), modelSupportsTools: true },
      { mcpServers: new Set([docsServer, secretServer]) }
    );
    const built = await buildToolSet(plan, {
      builtins: { echo },
      client: [
        { inputSchema: { properties: {}, type: "object" }, name: "confirm" },
      ],
      mcp,
    });
    expect(Object.keys(built.tools)).toEqual([
      "echo",
      "confirm",
      "docs_search",
    ]);
    expect(built.tools.confirm?.execute).toBeUndefined();
    expect(built.toolApproval).toEqual({
      confirm: "not-applicable",
      docs_search: "user-approval",
      echo: "not-applicable",
    });
    expect(built.skipped).toEqual([
      { name: "echo", reason: "duplicate" },
      { name: secretServer, reason: "mcp_unavailable" },
    ]);
  });

  it("leaves denied tools out of the set", async () => {
    const built = await buildToolSet(
      {
        approvals: { default: "auto", tools: {} },
        builtins: [{ approval: "deny", name: "echo" }],
        mcpServers: [],
        skipped: [],
      },
      { builtins: { echo } }
    );
    expect(built.tools).toEqual({});
    expect(built.skipped).toEqual([{ name: "echo", reason: "denied" }]);
  });
});
