// biome-ignore-all lint/suspicious/noTemplateCurlyInString: these tests exercise `${ENV}` references in YAML text.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parseConfig } from "./parse";
import { appConfigSchema } from "./schema";

const COMMENT_PREFIX = /^ {2}# ?/;

const mcpOf = (mcp: unknown) => appConfigSchema.parse({ mcp }).mcp;

describe("mcp config (184)", () => {
  it("defaults to no servers and lets users add http and sse servers", () => {
    expect(appConfigSchema.parse({}).mcp).toEqual({
      servers: [],
      userServers: { allowed: true, hosts: [], transports: ["http", "sse"] },
    });
  });

  it("keeps the old one-line http entry working, with defaults", () => {
    const [server] = mcpOf({
      servers: [{ name: "docs", url: "https://mcp.example.test/mcp" }],
    }).servers;
    expect(server).toEqual({
      allowUserOverride: true,
      auth: { type: "none" },
      default: "on",
      headers: {},
      name: "docs",
      tools: { deny: [] },
      transport: "http",
      url: "https://mcp.example.test/mcp",
    });
  });

  it("accepts stdio, oauth, required and tool filters", () => {
    const { servers } = mcpOf({
      servers: [
        {
          args: ["-y", "@modelcontextprotocol/server-filesystem", "/data"],
          command: "npx",
          default: "off",
          name: "files",
          transport: "stdio",
        },
        {
          auth: { scopes: ["read"], type: "oauth" },
          default: "required",
          name: "wiki",
          reason: "Company knowledge base",
          tools: { allow: ["search"], deny: ["delete"] },
          url: "https://wiki.example.test/mcp",
        },
      ],
    });
    expect(servers[0]).toMatchObject({
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/data"],
      env: {},
      transport: "stdio",
    });
    expect(servers[1]).toMatchObject({
      auth: { scopes: ["read"], type: "oauth" },
      default: "required",
      tools: { allow: ["search"], deny: ["delete"] },
    });
  });

  it("rejects duplicate names, bad names and a stdio entry with a url", () => {
    expect(
      appConfigSchema.safeParse({
        mcp: {
          servers: [
            { name: "docs", url: "https://a.test" },
            { name: "docs", url: "https://b.test" },
          ],
        },
      }).success
    ).toBe(false);
    expect(
      appConfigSchema.safeParse({
        mcp: { servers: [{ name: "Docs", url: "https://a.test" }] },
      }).success
    ).toBe(false);
    expect(
      appConfigSchema.safeParse({
        mcp: {
          servers: [
            { command: "x", name: "x", transport: "stdio", url: "https://a" },
          ],
        },
      }).success
    ).toBe(false);
  });

  it("turns an unset header reference into an absent value, not a boot failure", () => {
    const yaml = [
      "mcp:",
      "  servers:",
      "    - name: docs",
      "      url: https://mcp.example.test",
      '      headers: { Authorization: "${DOCS_MCP_AUTH}" }',
    ].join("\n");
    const parsed = parseConfig(yaml, {});
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const [server] = parsed.value.mcp.servers;
      expect(server && "headers" in server && server.headers).toEqual({
        Authorization: undefined,
      });
    }
  });

  it("restricts user servers by transport and host", () => {
    expect(
      mcpOf({ userServers: { hosts: ["*.example.com"], transports: ["http"] } })
        .userServers
    ).toEqual({
      allowed: true,
      hosts: ["*.example.com"],
      transports: ["http"],
    });
    expect(
      appConfigSchema.safeParse({
        mcp: { userServers: { transports: ["stdio"] } },
      }).success
    ).toBe(false);
  });

  it("parses the commented examples in app.config.example.yaml", () => {
    const example = readFileSync(
      fileURLToPath(
        new URL("../../../app.config.example.yaml", import.meta.url)
      ),
      "utf8"
    );
    const lines = example.split("\n");
    const start = lines.indexOf("  # servers:");
    const block = lines
      .slice(start)
      .filter((_line, index, all) =>
        all.slice(1, index + 1).every((each) => each.startsWith("  #   "))
      )
      .map((line) => line.replace(COMMENT_PREFIX, "  "));
    const parsed = parseConfig(["mcp:", ...block].join("\n"), {});
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.mcp.servers.map((server) => server.default)).toEqual([
        "on",
        "off",
        "required",
        "off",
      ]);
    }
  });
});
