import { parseProposedEdit } from "@workspace/code-ui/review/patch";
import { describe, expect, it } from "vitest";

import { artifactFileName, previewKind, versionEdit } from "./artifacts";

describe("artifactFileName", () => {
  it("names files so the viewer picks a language", () => {
    expect(artifactFileName("Invoice table", "react", null)).toBe(
      "Invoice-table.tsx"
    );
    expect(artifactFileName("fetch retry", "code", "python")).toBe(
      "fetch-retry.py"
    );
    expect(artifactFileName("notes.md", "markdown", null)).toBe("notes.md");
    expect(artifactFileName("  ", "html", null)).toBe("artifact.html");
  });
});

describe("versionEdit", () => {
  it("diffs two versions into hunks DiffView can show", () => {
    const before = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].join(
      "\n"
    );
    const after = ["a", "B", "c", "d", "e", "f", "g", "h", "i", "J"].join("\n");
    const edit = versionEdit("x.txt", before, after);
    expect(edit?.path).toBe("x.txt");
    expect(edit?.hunks.map((hunk) => hunk.hunkId)).toEqual(["h1", "h2"]);
    expect(edit?.patch).toContain("-b\n+B");
    expect(edit?.patch).toContain("-j");
    // The hunk ids line up with what DiffView parses, so it can render them.
    expect(edit && parseProposedEdit(edit).ok).toBe(true);
  });

  it("returns null when nothing changed", () => {
    expect(versionEdit("x.txt", "same\n", "same\n")).toBeNull();
  });
});

describe("previewKind", () => {
  it("frames HTML and SVG, renders markdown, and shows source for the rest", () => {
    expect(previewKind("html")).toBe("frame");
    expect(previewKind("svg")).toBe("frame");
    expect(previewKind("markdown")).toBe("markdown");
    expect(previewKind("react")).toBe("none");
  });
});
