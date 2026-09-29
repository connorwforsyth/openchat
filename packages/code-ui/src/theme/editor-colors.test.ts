import { getSharedHighlighter } from "@pierre/diffs";
import { describe, expect, it } from "vitest";

import { codeThemeNames } from "./code-theme";
import { resolveColorMap, resolveEditorColors } from "./editor-colors";
import { registerCodeThemes } from "./register";

// Shiki's stand-ins for colours it can't hand to TextMate: `#00000001`, ….
const PLACEHOLDER = /^#0{6}[0-9a-f]{2}$/i;

describe("resolveColorMap", () => {
  it("swaps placeholders for their colours, whatever the case", () => {
    expect(
      resolveColorMap(["#FFFFFF", "#0000000A", "#00000001"], {
        "#0000000a": "var(--muted-foreground)",
        "#00000001": "var(--foreground)",
      })
    ).toEqual(["#FFFFFF", "var(--muted-foreground)", "var(--foreground)"]);
  });

  it("leaves a map without replacements alone", () => {
    expect(resolveColorMap(["#000000", "#00000001"])).toEqual([
      "#000000",
      "#00000001",
    ]);
  });
});

describe("resolveEditorColors", () => {
  it("gives the editor the themes' token colours, not Shiki's placeholders", async () => {
    registerCodeThemes();
    const highlighter = await getSharedHighlighter({
      langs: ["text"],
      themes: [codeThemeNames.light, codeThemeNames.dark],
    });
    // What the editor paints with unaided (@pierre/diffs 1.5.1). If this
    // fails, the library resolves them itself and editor-colors.ts can go.
    expect(
      highlighter
        .setTheme(codeThemeNames.light)
        .colorMap.some((color) => PLACEHOLDER.test(color))
    ).toBe(true);

    resolveEditorColors(highlighter);
    // Idempotent: a second editor module (HMR) must not wrap it twice.
    resolveEditorColors(highlighter);

    for (const name of [codeThemeNames.light, codeThemeNames.dark]) {
      const { colorMap } = highlighter.setTheme(name);
      expect(colorMap.filter((color) => PLACEHOLDER.test(color))).toEqual([]);
      expect(colorMap).toContain("var(--foreground)");
    }
  });
});
