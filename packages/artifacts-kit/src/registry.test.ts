import { describe, expect, it } from "vitest";

import { codeKind } from "./kinds/code";
import { markdownKind } from "./kinds/markdown";
import { createArtifactKindRegistry } from "./registry";

describe("createArtifactKindRegistry", () => {
  const registry = createArtifactKindRegistry([markdownKind, codeKind]);

  it("lists its kinds in order and finds each by name", () => {
    expect(registry.kinds).toEqual(["markdown", "code"]);
    expect(registry.get("code")).toBe(codeKind);
    expect(registry.get("site")).toBeUndefined();
    expect(registry.list()).toEqual([markdownKind, codeKind]);
  });

  it("checks content against the kind's definition", () => {
    expect(registry.check("markdown", "# Notes")).toEqual([]);
    expect(registry.check("markdown", " ")).toEqual([
      "content isn't a valid markdown artifact",
    ]);
  });

  it("refuses a kind it doesn't have", () => {
    expect(registry.check("site", "<p>")).toEqual([
      '"site" isn\'t an artifact kind here',
    ]);
  });

  it("refuses a kind defined twice", () => {
    expect(() => createArtifactKindRegistry([codeKind, codeKind])).toThrow(
      'artifact kind "code" is defined twice'
    );
  });

  it("gives instructions only for kinds that have some", () => {
    expect(registry.instructionFiles()).toEqual([]);
    const strict = createArtifactKindRegistry([
      { ...codeKind, instructions: "Comment every function." },
      markdownKind,
    ]);
    expect(strict.instructionFiles()).toEqual([
      { source: "kinds/code", text: "Comment every function." },
    ]);
  });
});
