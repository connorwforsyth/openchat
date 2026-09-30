import { describe, expect, it } from "vitest";

import {
  bundlePrompts,
  generatedModule,
  promptParts,
  promptText,
} from "./codegen";

describe("promptText", () => {
  it("drops the line breaks around a file and nothing else", () => {
    expect(promptText("\n  Be terse. \r\n\r\nSecond line.\n\n")).toBe(
      "  Be terse. \n\nSecond line."
    );
    expect(promptText("")).toBe("");
    expect(promptText("\n")).toBe("");
  });
});

describe("promptParts", () => {
  it("is null for a file without markers", () => {
    expect(promptParts("fragments/a.md", "Just text.\n")).toBeNull();
  });

  it("splits a file at its part markers", () => {
    expect(
      promptParts(
        "fragments/a.md",
        [
          "",
          "<!-- part: intro -->",
          "Hello {{name}}.",
          "",
          "Second paragraph.",
          "",
          "<!-- part: emptyPart -->",
          "<!-- part: last -->",
          "<!-- not a marker -->",
          "",
        ].join("\n")
      )
    ).toEqual({
      emptyPart: "",
      intro: "Hello {{name}}.\n\nSecond paragraph.",
      last: "<!-- not a marker -->",
    });
  });

  it("rejects text before the first marker and a repeated name", () => {
    expect(() =>
      promptParts("fragments/a.md", "stray\n<!-- part: one -->\ntext")
    ).toThrow("fragments/a.md: text before the first part marker");
    expect(() =>
      promptParts("fragments/a.md", "<!-- part: one -->\n<!-- part: one -->")
    ).toThrow('fragments/a.md: part "one" appears twice');
  });
});

describe("bundlePrompts", () => {
  const bundle = bundlePrompts({
    "base/10-identity.md": "",
    "base/20-safety.md": "Be safe.\n",
    "base/README.md": "Not a layer.",
    "fragments/split.md": "<!-- part: one -->\nOne.\n",
    "fragments/whole.md": "Whole.\n",
    "README.md": "About this folder.",
  });

  it("orders the base files by name and leaves the READMEs out", () => {
    expect(bundle.base).toEqual([
      { source: "base/10-identity.md", text: "" },
      { source: "base/20-safety.md", text: "Be safe." },
    ]);
  });

  it("keys fragments by file name, whole or in parts", () => {
    expect(bundle.fragments).toEqual({
      split: { parts: { one: "One." }, source: "fragments/split.md" },
      whole: { source: "fragments/whole.md", text: "Whole." },
    });
  });

  it("emits a module that exports the bundle as constants", () => {
    const source = generatedModule(bundle);
    expect(source).toContain("export const BASE = [");
    expect(source).toContain("export const FRAGMENTS = {");
    expect(source).toContain('"text": "Be safe."');
  });
});
