import type { Connector } from "@workspace/contract/schemas/library";
import { describe, expect, it } from "vitest";

import { matchConnectors, usableConnectors } from "./connectors";

const connector = (overrides: Partial<Connector>): Connector => ({
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

describe("usableConnectors", () => {
  it("keeps what this surface can run", () => {
    const docs = connector({});
    expect(
      usableConnectors([
        docs,
        connector({ availability: { state: "desktop_only" }, name: "files" }),
        connector({
          availability: { message: "Needs X", state: "unconfigured" },
          name: "search",
        }),
      ])
    ).toEqual([docs]);
  });
});

describe("matchConnectors", () => {
  const docs = connector({});
  const audit = connector({
    lock: { reason: null, type: "required" },
    name: "audit",
    title: "Audit log",
  });

  it("finds by name or title, ignoring case", () => {
    expect(matchConnectors([docs, audit], "COMPANY")).toEqual([docs]);
    expect(matchConnectors([docs, audit], "doc")).toEqual([docs]);
  });

  it("lists nothing for a bare slash, and never a locked connector", () => {
    expect(matchConnectors([docs], "")).toEqual([]);
    expect(matchConnectors([audit], "audit")).toEqual([]);
  });
});
