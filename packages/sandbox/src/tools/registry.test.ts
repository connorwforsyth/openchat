import { readFile } from "node:fs/promises";
import { ARTIFACT_TOOLS } from "@workspace/ai/tools/artifacts";
import {
  clientToolDefinition,
  mcpToolDefinition,
} from "@workspace/ai/tools/registry/adapt";
import { GENERATE_IMAGE_TOOL } from "@workspace/ai/tools/registry/generate-image";
import { SKILL_AUTHORING_TOOLS } from "@workspace/ai/tools/registry/skill-authoring";
import {
  chatSandboxApproval,
  FILE_CHANGE_TOOLS,
  SANDBOX_TOOLS as SERVER_SANDBOX_TOOLS,
} from "@workspace/server/runs/sandbox";
import { ok } from "@workspace/shared/result";
import { dynamicTool, jsonSchema, type ToolApprovalStatus } from "ai";
import { describe, expect, it } from "vitest";

import { builtinTools, SANDBOX_TOOLS } from "./registry";
import { createSandboxTools, SANDBOX_TOOL_NAMES } from "./tools";

// The registry's defaults are only worth reading if they're what the run
// wiring does today (080). Nothing decides a call from them yet, so these
// tests hold them to the wiring, and to the golden snapshot of what a plain
// chat is actually given.

/** A default as the executor would be told it. */
const statusOf = (approval: "ask" | "auto"): ToolApprovalStatus =>
  approval === "ask" ? "user-approval" : "not-applicable";

const unused = () => Promise.reject(new Error("not called"));

describe("the built-in tool registry", () => {
  it("holds every built-in, one definition each", () => {
    expect([...builtinTools.names].sort()).toEqual([
      "bash",
      "create_artifact",
      "create_skill",
      "edit",
      "file_search",
      "generate_image",
      "load_skill",
      "preview",
      "publish_skill",
      "read",
      "update_artifact",
      "update_memory",
      "update_skill",
      "web_search",
      "write",
    ]);
  });

  it("names the sandbox tools the way the turn resolver does", () => {
    expect(SANDBOX_TOOLS.map((definition) => definition.name)).toEqual([
      ...SANDBOX_TOOL_NAMES,
    ]);
    expect(builtinTools.withCapability("sandbox")).toEqual([
      ...SERVER_SANDBOX_TOOLS,
    ]);
  });

  it("defaults to what a plain chat does with the sandbox tools", () => {
    const tools = createSandboxTools({
      sandbox: {
        exec: unused,
        exposePort: unused,
        readFile: unused,
        writeFile: () => Promise.resolve(ok(undefined)),
      },
    });
    expect(
      Object.fromEntries(
        SANDBOX_TOOLS.map(({ approval, name }) => [name, statusOf(approval)])
      )
    ).toEqual(chatSandboxApproval(tools));
  });

  it("asks by default for exactly the tools the resolver makes ask", () => {
    const asking = Object.entries(builtinTools.approvals)
      .filter(([, approval]) => approval === "ask")
      .map(([name]) => name);
    expect(asking.sort()).toEqual(
      [
        ...FILE_CHANGE_TOOLS,
        ...ARTIFACT_TOOLS,
        ...SKILL_AUTHORING_TOOLS,
        // `models.image.approval` defaults to `ask` (138).
        GENERATE_IMAGE_TOOL,
      ].sort()
    );
  });

  it("matches the golden snapshot of a plain chat: descriptions and approvals", async () => {
    const golden = JSON.parse(
      await readFile(
        new URL("./__snapshots__/tool-golden.json.snap", import.meta.url),
        "utf8"
      )
    ) as {
      readonly clientTools: readonly { readonly approval: string | null }[];
      readonly plainChat: readonly {
        readonly approval: string | null;
        readonly model: { readonly description: string };
        readonly name: string;
      }[];
    };
    const mcp = mcpToolDefinition(
      "open__echo",
      dynamicTool({
        execute: unused,
        inputSchema: jsonSchema({ type: "object" }),
      })
    );
    const seen = new Set<string>();
    for (const tool of golden.plainChat) {
      // A turn that says nothing about a tool lets it run: that's `auto`.
      const status = tool.approval ?? "not-applicable";
      const definition = builtinTools.get(tool.name);
      if (definition) {
        seen.add(tool.name);
        expect([tool.name, statusOf(definition.approval)]).toEqual([
          tool.name,
          status,
        ]);
        expect(definition.description).toBe(tool.model.description);
      } else {
        // Everything else a plain chat gets is an MCP tool.
        expect([tool.name, statusOf(mcp.approval)]).toEqual([
          tool.name,
          status,
        ]);
      }
    }
    expect([...seen].sort()).toEqual([...builtinTools.names].sort());

    const client = clientToolDefinition({
      inputSchema: { type: "object" },
      name: "pick_folder",
    });
    expect(golden.clientTools.map((tool) => tool.approval)).toEqual([
      statusOf(client.approval),
    ]);
  });
});
