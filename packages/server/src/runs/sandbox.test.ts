import { tool } from "ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  chatSandboxApproval,
  SANDBOX_TOOLS,
  withSandboxTools,
} from "./sandbox";

const agent = {
  approvals: { default: "auto" as const, tools: {} },
  mcpServers: [],
  sandboxProvider: "docker" as const,
  tools: ["web_search"],
};

describe("withSandboxTools", () => {
  it("offers every sandbox tool when the agent named none, and file changes ask", () => {
    const planned = withSandboxTools(agent, { provider: "just-bash" });
    expect(planned.sandboxProvider).toBe("just-bash");
    expect(planned.tools).toEqual(["web_search", ...SANDBOX_TOOLS]);
    expect(planned.approvals.tools).toEqual({ edit: "ask", write: "ask" });
  });

  it("keeps the tools the agent chose and its explicit overrides", () => {
    const planned = withSandboxTools(
      {
        ...agent,
        approvals: { default: "auto", tools: { write: "auto" } },
        tools: ["bash", "write"],
      },
      { provider: "docker" }
    );
    expect(planned.tools).toEqual(["bash", "write"]);
    expect(planned.approvals.tools).toEqual({ edit: "ask", write: "auto" });
  });
});

describe("chatSandboxApproval", () => {
  it("asks before file changes only", () => {
    const any = tool({ inputSchema: z.object({}) });
    expect(chatSandboxApproval({ bash: any, edit: any, write: any })).toEqual({
      bash: "not-applicable",
      edit: "user-approval",
      write: "user-approval",
    });
  });
});
