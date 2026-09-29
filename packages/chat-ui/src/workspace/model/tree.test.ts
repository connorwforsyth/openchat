import { describe, expect, it } from "vitest";

import { toSandboxPath, toTreePaths } from "./tree";

describe("toTreePaths", () => {
  it("makes paths relative, marks directories and drops the outside", () => {
    expect(
      toTreePaths([
        { modifiedAt: null, path: "/work/src/a.ts", size: 1, type: "file" },
        { modifiedAt: null, path: "/work/src", size: null, type: "directory" },
        { modifiedAt: null, path: "/work/README.md", size: 1, type: "file" },
        { modifiedAt: null, path: "/etc/passwd", size: 1, type: "file" },
      ])
    ).toEqual(["README.md", "src/", "src/a.ts"]);
  });

  it("maps tree paths back to sandbox paths", () => {
    expect(toSandboxPath("src/a.ts")).toBe("/work/src/a.ts");
    expect(toSandboxPath("src/")).toBe("/work/src");
  });
});
