import { describe, expect, it } from "vitest";

import { twoHunkEdit } from "./fixtures";
import { normalisePatch, parseProposedEdit } from "./patch";

describe("normalisePatch", () => {
  it("adds a header to a bare patch", () => {
    expect(normalisePatch("src/a.ts", "@@ -1 +1 @@\n-a\n+b\n")).toBe(
      "--- src/a.ts\n+++ src/a.ts\n@@ -1 +1 @@\n-a\n+b\n"
    );
  });

  it("replaces a git header so prefixes don't read as a rename", () => {
    const patch =
      "diff --git a/x b/x\nindex 1..2 100644\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n";
    expect(normalisePatch("x", patch)).toBe(
      "--- x\n+++ x\n@@ -1 +1 @@\n-a\n+b\n"
    );
  });
});

describe("parseProposedEdit", () => {
  it("pairs each parsed hunk with its contract id and anchor", () => {
    const result = parseProposedEdit(twoHunkEdit);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.fileDiff.type).toBe("change");
    expect(result.value.fileDiff.name).toBe("src/billing.ts");
    expect(result.value.hunks).toEqual([
      {
        anchor: { lineNumber: 6, side: "additions" },
        hunkId: "h1",
        index: 0,
      },
      {
        anchor: { lineNumber: 10, side: "additions" },
        hunkId: "h2",
        index: 1,
      },
    ]);
  });

  it("matches hunks listed out of order", () => {
    const result = parseProposedEdit({
      ...twoHunkEdit,
      hunks: [...twoHunkEdit.hunks].reverse(),
    });
    expect(result.ok && result.value.hunks.map((hunk) => hunk.hunkId)).toEqual([
      "h1",
      "h2",
    ]);
  });

  it("anchors a pure deletion on the deletions side", () => {
    const result = parseProposedEdit({
      hunks: [
        { hunkId: "d", newLines: 1, newStart: 1, oldLines: 3, oldStart: 1 },
      ],
      patch: "@@ -1,3 +1,1 @@\n keep\n-gone\n-also gone\n",
      path: "x.txt",
    });
    expect(result.ok && result.value.hunks[0]?.anchor).toEqual({
      lineNumber: 3,
      side: "deletions",
    });
  });

  it("reads the contract fixture's headerless patch", () => {
    const result = parseProposedEdit({
      hunks: [
        { hunkId: "h1", newLines: 3, newStart: 10, oldLines: 2, oldStart: 10 },
      ],
      patch: "@@ -10,2 +10,3 @@\n-a\n-b\n+a\n+b\n+c\n",
      path: "src/billing.ts",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a patch with no hunks", () => {
    expect(
      parseProposedEdit({
        hunks: [
          { hunkId: "h", newLines: 1, newStart: 1, oldLines: 1, oldStart: 1 },
        ],
        patch: "",
        path: "x",
      })
    ).toEqual({ error: { kind: "no-hunks" }, ok: false });
  });
});
