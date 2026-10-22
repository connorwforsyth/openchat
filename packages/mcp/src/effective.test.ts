import { appConfigSchema } from "@workspace/config/schema";
import type { LibraryItemId } from "@workspace/contract/schemas/common";
import type { UserServerPolicy } from "@workspace/contract/schemas/library";
import { describe, expect, it } from "vitest";

import {
  anyCustomized,
  checkUserServer,
  disabledServerIds,
  effectiveMcpServers,
  enabledServerIds,
  excludedTools,
  type LibraryMcpServer,
  type McpChoice,
  type McpChoices,
  type McpInputs,
  mcpServerTools,
  toggleMcpServer,
  toggleMcpServerTool,
} from "./effective";
import { instanceServerId } from "./server-config";

const catalogOf = (servers: unknown[]) =>
  appConfigSchema.shape.mcp.parse({ servers }).servers;

const libraryId = "0199a000-0000-7000-8000-000000000001" as LibraryItemId;
const mine: LibraryMcpServer = {
  auth: "oauth",
  description: "",
  id: libraryId,
  name: "my-notes",
  transport: "http",
};

const choices = (
  entries: readonly (readonly [
    LibraryItemId,
    boolean | null,
    McpChoice["tools"]?,
  ])[]
): McpChoices =>
  new Map(entries.map(([id, enabled, tools = {}]) => [id, { enabled, tools }]));

const run = (overrides: Partial<McpInputs>) =>
  effectiveMcpServers({
    catalog: [],
    library: [],
    prefs: new Map(),
    ...overrides,
  });

const docs = { name: "docs", url: "https://docs.example.test/mcp" };

describe("effectiveMcpServers", () => {
  it("is empty with no catalog and no library", () => {
    expect(run({})).toEqual([]);
  });

  it("starts catalog entries in their operator default", () => {
    const [on, off] = run({
      catalog: catalogOf([docs, { ...docs, default: "off", name: "beta" }]),
    });
    expect(on).toMatchObject({
      enabled: true,
      id: instanceServerId("docs"),
      lock: null,
      source: "instance",
      title: "docs",
    });
    expect(off).toMatchObject({ enabled: false, lock: null, name: "beta" });
  });

  it("applies the user's choice over the default", () => {
    const id = instanceServerId("docs");
    const [connector] = run({
      catalog: catalogOf([docs]),
      prefs: choices([[id, false]]),
    });
    expect(connector?.enabled).toBe(false);
  });

  it("keeps required entries on and locked, whatever the user stored", () => {
    const id = instanceServerId("audit");
    const [connector] = run({
      catalog: catalogOf([
        { ...docs, default: "required", name: "audit", reason: "IT policy" },
      ]),
      prefs: choices([[id, false]]),
    });
    expect(connector).toMatchObject({
      enabled: true,
      lock: { reason: "IT policy", type: "required" },
    });
  });

  it("locks entries the operator won't let users change, at the default", () => {
    const id = instanceServerId("docs");
    const [connector] = run({
      catalog: catalogOf([
        { ...docs, allowUserOverride: false, default: "off" },
      ]),
      prefs: choices([[id, true]]),
    });
    expect(connector).toMatchObject({
      enabled: false,
      lock: { reason: null, type: "operator" },
    });
  });

  it("marks stdio entries desktop-only on the server, and available on desktop", () => {
    const catalog = catalogOf([
      { command: "npx", name: "files", transport: "stdio" },
    ]);
    expect(run({ catalog })[0]?.availability).toEqual({
      state: "desktop_only",
    });
    expect(run({ catalog, surface: "desktop" })[0]?.availability).toEqual({
      state: "available",
    });
  });

  it("marks entries with an unset secret unconfigured, naming only the header", () => {
    const [connector] = run({
      catalog: catalogOf([{ ...docs, headers: { Authorization: undefined } }]),
    });
    expect(connector?.availability).toEqual({
      message: "Needs Authorization set by the operator.",
      state: "unconfigured",
    });
  });

  it("lists library servers after the catalog, on unless turned off", () => {
    const connectors = run({ catalog: catalogOf([docs]), library: [mine] });
    expect(connectors.map((c) => c.source)).toEqual(["instance", "library"]);
    expect(connectors[1]).toMatchObject({
      auth: "oauth",
      enabled: true,
      lock: null,
      title: "my-notes",
    });
    expect(
      run({ library: [mine], prefs: choices([[libraryId, false]]) })[0]?.enabled
    ).toBe(false);
  });

  it("reports library servers this surface can't run", () => {
    const [connector] = run({ library: [{ ...mine, transport: "stdio" }] });
    expect(connector?.availability).toEqual({ state: "desktop_only" });
  });
});

describe("enabledServerIds and disabledServerIds", () => {
  const connectors = run({
    catalog: catalogOf([
      docs,
      { ...docs, default: "off", name: "beta" },
      { command: "npx", name: "files", transport: "stdio" },
    ]),
    library: [mine],
  });

  it("offers runs only what is on and runnable here", () => {
    expect(enabledServerIds(connectors)).toEqual([
      instanceServerId("docs"),
      libraryId,
    ]);
  });

  it("names what a run must leave out, even when an agent lists it", () => {
    expect([...disabledServerIds(connectors)]).toEqual([
      instanceServerId("beta"),
      instanceServerId("files"),
    ]);
  });
});

describe("tools (188)", () => {
  const id = instanceServerId("docs");
  const audited = {
    ...docs,
    tools: { required: ["log_event"] },
  };

  it("has every tool on with no choices", () => {
    const [connector] = run({ catalog: catalogOf([docs]) });
    expect(connector).toMatchObject({
      customized: false,
      disabledTools: [],
      requiredTools: [],
    });
  });

  it("takes the user's tool switches, never one the operator requires", () => {
    const [connector] = run({
      catalog: catalogOf([audited]),
      prefs: choices([
        [id, null, { delete_page: false, log_event: false, search: true }],
      ]),
    });
    expect(connector).toMatchObject({
      disabledTools: ["delete_page"],
      enabled: true,
      requiredTools: ["log_event"],
    });
  });

  it("layers a chat's choices over the user's, per connector and per tool", () => {
    const [connector] = run({
      catalog: catalogOf([docs]),
      chat: choices([[id, null, { a: true, c: false }]]),
      prefs: choices([[id, false, { a: false, b: false }]]),
    });
    // The chat said nothing about the switch, so the user's `off` stands.
    expect(connector).toMatchObject({
      customized: true,
      disabledTools: ["b", "c"],
      enabled: false,
    });
    const [on] = run({
      catalog: catalogOf([docs]),
      chat: choices([[id, true]]),
      prefs: choices([[id, false]]),
    });
    expect(on).toMatchObject({ customized: true, enabled: true });
  });

  it("isn't customized when the chat's choices match the defaults", () => {
    const connectors = run({
      catalog: catalogOf([docs]),
      chat: choices([[id, true, { a: true }]]),
    });
    expect(connectors[0]?.customized).toBe(false);
    expect(anyCustomized(connectors)).toBe(false);
  });

  it("can't turn on, off or unlock what the operator locked, from a chat either", () => {
    const [required] = run({
      catalog: catalogOf([{ ...audited, default: "required", name: "docs" }]),
      chat: choices([[id, false, { log_event: false }]]),
    });
    expect(required).toMatchObject({
      customized: false,
      disabledTools: [],
      enabled: true,
    });
  });

  it("lists library tools for the run to leave out", () => {
    const connectors = run({
      catalog: catalogOf([docs]),
      chat: choices([[libraryId, null, { write: false }]]),
      library: [mine],
    });
    expect(excludedTools(connectors)).toEqual(
      new Map([[libraryId, ["write"]]])
    );
  });

  it("marks each listed tool on or off, and required ones locked", () => {
    const [connector] = run({
      catalog: catalogOf([audited]),
      prefs: choices([[id, null, { search: false }]]),
    });
    const listed = [
      { description: null, inputSchema: {}, name: "search" },
      { description: "Audit", inputSchema: {}, name: "log_event" },
      { description: null, inputSchema: {}, name: "fetch" },
    ];
    expect(connector && mcpServerTools(connector, listed)).toEqual([
      { description: null, enabled: false, lock: null, name: "search" },
      {
        description: "Audit",
        enabled: true,
        lock: { reason: null, type: "required" },
        name: "log_event",
      },
      { description: null, enabled: true, lock: null, name: "fetch" },
    ]);
  });

  it("flips a tool, and refuses a required one", () => {
    const [connector] = run({ catalog: catalogOf([audited]) });
    if (!connector) {
      throw new Error("no connector");
    }
    const off = toggleMcpServerTool(connector, "search", false);
    if (!off.ok) {
      throw new Error("not toggled");
    }
    expect(off.value.disabledTools).toEqual(["search"]);
    const back = toggleMcpServerTool(off.value, "search", true);
    expect(back.ok ? back.value.disabledTools : null).toEqual([]);
    expect(toggleMcpServerTool(connector, "log_event", false)).toEqual({
      error: { type: "locked" },
      ok: false,
    });
  });
});

describe("toggleMcpServer", () => {
  const [open, required] = run({
    catalog: catalogOf([docs, { ...docs, default: "required", name: "audit" }]),
  });

  it("returns the new state for an unlocked connector", () => {
    expect(open && toggleMcpServer(open, false)).toEqual({
      ok: true,
      value: { ...open, enabled: false },
    });
  });

  it("refuses a locked connector", () => {
    expect(required && toggleMcpServer(required, false)).toEqual({
      error: { type: "locked" },
      ok: false,
    });
  });
});

describe("checkUserServer", () => {
  const policy: UserServerPolicy = {
    allowed: true,
    hosts: [],
    transports: ["http", "sse"],
  };

  it("allows any public host when hosts is empty", () => {
    expect(
      checkUserServer(policy, { transport: "http", url: "https://a.test/mcp" })
        .ok
    ).toBe(true);
  });

  it("refuses when users may not add servers", () => {
    expect(
      checkUserServer(
        { ...policy, allowed: false },
        { transport: "http", url: "https://a.test" }
      )
    ).toEqual({
      error: { message: "This instance doesn't allow adding MCP servers." },
      ok: false,
    });
  });

  it("refuses a transport the operator didn't allow", () => {
    expect(
      checkUserServer(
        { ...policy, transports: ["http"] },
        { transport: "sse", url: "https://a.test" }
      ).ok
    ).toBe(false);
    expect(
      checkUserServer(policy, { transport: "stdio", url: undefined }).ok
    ).toBe(false);
  });

  it("matches hosts exactly or by *. subdomain", () => {
    const hosts = { ...policy, hosts: ["mcp.example.com", "*.corp.test"] };
    const check = (url: string) =>
      checkUserServer(hosts, { transport: "http", url }).ok;
    expect(check("https://mcp.example.com/x")).toBe(true);
    expect(check("https://a.corp.test")).toBe(true);
    expect(check("https://corp.test")).toBe(false);
    expect(check("https://evil-mcp.example.com")).toBe(false);
    expect(check("https://a.corp.test.evil.com")).toBe(false);
  });
});
