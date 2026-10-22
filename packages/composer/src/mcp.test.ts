import type { Connector } from "@workspace/contract/schemas/library";
import { describe, expect, it } from "vitest";

import { matchMcpServers, usableMcpServers } from "./mcp";

const server = (overrides: Partial<Connector>): Connector => ({
  auth: "none",
  availability: { state: "available" },
  customized: false,
  description: null,
  disabledTools: [],
  enabled: true,
  id: "0199a000-0000-7000-8000-000000000001" as Connector["id"],
  lock: null,
  name: "docs",
  requiredTools: [],
  source: "instance",
  title: "Company docs",
  transport: "http",
  ...overrides,
});

describe("usableMcpServers", () => {
  it("keeps what this surface can run", () => {
    const docs = server({});
    expect(
      usableMcpServers([
        docs,
        server({ availability: { state: "desktop_only" }, name: "files" }),
        server({
          availability: { message: "Needs X", state: "unconfigured" },
          name: "search",
        }),
      ])
    ).toEqual([docs]);
  });
});

describe("matchMcpServers", () => {
  const docs = server({});
  const audit = server({
    lock: { reason: null, type: "required" },
    name: "audit",
    title: "Audit log",
  });

  it("finds by name or title, ignoring case", () => {
    expect(matchMcpServers([docs, audit], "COMPANY")).toEqual([docs]);
    expect(matchMcpServers([docs, audit], "doc")).toEqual([docs]);
  });

  it("lists nothing for a bare slash, and never a locked server", () => {
    expect(matchMcpServers([docs], "")).toEqual([]);
    expect(matchMcpServers([audit], "audit")).toEqual([]);
  });
});
