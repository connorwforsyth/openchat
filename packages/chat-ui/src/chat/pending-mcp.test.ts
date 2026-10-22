import type { LibraryItemId } from "@workspace/contract/schemas/common";
import type {
  Connector,
  ConnectorList,
} from "@workspace/contract/schemas/library";
import { describe, expect, it } from "vitest";

import { addPending, toolsWithPending, withPending } from "./pending-mcp";

const id = "0199a000-0000-7000-8000-0000000000aa" as LibraryItemId;
const docs: Connector = {
  auth: "none",
  availability: { state: "available" },
  customized: false,
  description: null,
  disabledTools: [],
  enabled: true,
  id,
  lock: null,
  name: "docs",
  requiredTools: ["log"],
  source: "instance",
  title: "Docs",
  transport: "http",
};
const list: ConnectorList = {
  connectors: [docs],
  customized: false,
  userServers: { allowed: true, hosts: [], transports: ["http"] },
};

describe("pending server changes (188)", () => {
  it("keeps the last change per switch", () => {
    const pending = addPending(
      addPending([], { enabled: false, id, kind: "server" }),
      { enabled: true, id, kind: "server" }
    );
    expect(pending).toEqual([{ enabled: true, id, kind: "server" }]);
  });

  it("shows changes over the defaults and marks the chat customized", () => {
    const pending = addPending(
      addPending([], { enabled: false, id, kind: "tool", tool: "search" }),
      { enabled: false, id, kind: "tool", tool: "log" }
    );
    const shown = withPending(list, pending);
    expect(shown.customized).toBe(true);
    // A required tool stays on.
    expect(shown.connectors[0]?.disabledTools).toEqual(["search"]);
    expect(
      toolsWithPending(shown.connectors[0], {
        reachable: true,
        tools: [
          { description: null, enabled: true, lock: null, name: "search" },
        ],
      }).tools[0]?.enabled
    ).toBe(false);
  });

  it("isn't customized when the changes undo themselves", () => {
    const pending = addPending([], { enabled: true, id, kind: "server" });
    expect(withPending(list, pending).customized).toBe(false);
  });
});
