import { parseProposedEdit } from "@workspace/code-ui/review/patch";
import { describe, expect, it } from "vitest";

import {
  artifactFileName,
  previewKind,
  previewPlan,
  versionEdit,
} from "./artifacts";

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

describe("previewPlan", () => {
  const origin = "http://artifacts.localhost:3910";

  it("renders every runtime kind in the runtime when there is one", () => {
    for (const kind of ["html", "svg", "react", "mermaid", "site"] as const) {
      expect(previewPlan(kind, origin)).toEqual({ origin, type: "runtime" });
    }
  });

  it("without the runtime, frames HTML and SVG and says why React, Mermaid and sites can't preview", () => {
    expect(previewPlan("html", null)).toEqual({
      panel: "frame",
      type: "panel",
    });
    expect(previewPlan("svg", null)).toEqual({ panel: "frame", type: "panel" });
    for (const kind of ["react", "mermaid", "site"] as const) {
      expect(previewPlan(kind, null)).toEqual({
        reason: "no-runtime",
        type: "unavailable",
      });
    }
  });

  it("draws Markdown and images itself, and gives code no preview", () => {
    expect(previewPlan("markdown", origin)).toEqual({
      panel: "markdown",
      type: "panel",
    });
    expect(previewPlan("image", null)).toEqual({
      panel: "image",
      type: "panel",
    });
    expect(previewPlan("code", origin)).toEqual({ type: "source" });
  });
});
