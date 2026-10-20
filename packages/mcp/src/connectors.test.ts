import { appConfigSchema } from "@workspace/config/schema";
import type { LibraryItemId } from "@workspace/contract/schemas/common";
import type { UserServerPolicy } from "@workspace/contract/schemas/library";
import { describe, expect, it } from "vitest";

import {
  type ConnectorInputs,
  checkUserServer,
  disabledServerIds,
  effectiveConnectors,
  enabledServerIds,
  type LibraryConnector,
  toggleConnector,
} from "./connectors";
import { instanceServerId } from "./server-config";

const catalogOf = (servers: unknown[]) =>
  appConfigSchema.shape.mcp.parse({ servers }).servers;

const libraryId = "0199a000-0000-7000-8000-000000000001" as LibraryItemId;
const mine: LibraryConnector = {
  auth: "oauth",
  description: "",
  id: libraryId,
  name: "my-notes",
  transport: "http",
};

const run = (overrides: Partial<ConnectorInputs>) =>
  effectiveConnectors({
    catalog: [],
    library: [],
    prefs: new Map(),
    ...overrides,
  });

const docs = { name: "docs", url: "https://docs.example.test/mcp" };

describe("effectiveConnectors", () => {
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
      prefs: new Map([[id, false]]),
    });
    expect(connector?.enabled).toBe(false);
  });

  it("keeps required entries on and locked, whatever the user stored", () => {
    const id = instanceServerId("audit");
    const [connector] = run({
      catalog: catalogOf([
        { ...docs, default: "required", name: "audit", reason: "IT policy" },
      ]),
      prefs: new Map([[id, false]]),
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
      prefs: new Map([[id, true]]),
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
      run({ library: [mine], prefs: new Map([[libraryId, false]]) })[0]?.enabled
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

describe("toggleConnector", () => {
  const [open, required] = run({
    catalog: catalogOf([docs, { ...docs, default: "required", name: "audit" }]),
  });

  it("returns the new state for an unlocked connector", () => {
    expect(open && toggleConnector(open, false)).toEqual({
      ok: true,
      value: { ...open, enabled: false },
    });
  });

  it("refuses a locked connector", () => {
    expect(required && toggleConnector(required, false)).toEqual({
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
