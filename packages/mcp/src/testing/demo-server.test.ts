import { appConfigSchema } from "@workspace/config/schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createMcp } from "../create";
import { instanceServerId } from "../server-config";
import { type DemoServer, startDemoServer } from "./demo-server";

// The dev demo server (188) answers `tools/list` the way the app reads it.

let demo: DemoServer;
beforeAll(async () => {
  demo = await startDemoServer(0);
});
afterAll(() => demo.close());

describe("demo MCP server", () => {
  it("lists its three tools to the connection manager", async () => {
    const mcp = createMcp({
      config: {
        brand: { name: "Test" } as never,
        mcp: appConfigSchema.shape.mcp.parse({
          servers: [{ name: "demo", url: demo.url }],
        }),
      },
      env: {},
    });
    try {
      const tools = await mcp.manager.listTools(
        instanceServerId("demo"),
        "0199a000-0000-7000-8000-000000000009" as never
      );
      expect(tools.ok && tools.value.map((tool) => tool.name)).toEqual([
        "current_time",
        "roll_dice",
        "word_count",
      ]);
    } finally {
      await mcp.manager.close();
    }
  });
});
