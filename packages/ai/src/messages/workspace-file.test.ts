import { describe, expect, it } from "vitest";

import { WORKSPACE_FILE_DATA, workspaceFileRefs } from "./workspace-file";

describe("workspaceFileRefs", () => {
  it("lists a message's workspace-file mentions once each, skipping malformed ones", () => {
    expect(
      workspaceFileRefs([
        { text: "compare @a.ts and @b.ts", type: "text" },
        { data: { path: "a.ts" }, name: WORKSPACE_FILE_DATA, type: "data" },
        { data: { path: "b.ts" }, name: WORKSPACE_FILE_DATA, type: "data" },
        { data: { path: "a.ts" }, name: WORKSPACE_FILE_DATA, type: "data" },
        { data: { path: "" }, name: WORKSPACE_FILE_DATA, type: "data" },
        { data: { path: "c.ts" }, name: "memory-update", type: "data" },
      ])
    ).toEqual([{ path: "a.ts" }, { path: "b.ts" }]);
  });
});
