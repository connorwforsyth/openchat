import {
  type DiffsHighlighter,
  getHighlighterIfLoaded,
  getSharedHighlighter,
} from "@pierre/diffs";

import { codeThemeNames } from "./code-theme";

// Ticket 064. Our Shiki themes colour code with CSS expressions over the ui
// tokens (code-theme.ts), and Shiki can't hand those to its TextMate
// registry: it swaps each one for a placeholder hex (`#00000001`, …) and
// records the real value in the theme's `colorReplacements`. Shiki's own
// output (read-only views, diffs) swaps them back; the @pierre/diffs editor
// (1.5.1) tokenizes with the registry's raw colour map and doesn't, so every
// line it tokenizes is drawn in near-transparent black. It re-tokenizes the
// whole file when the colour scheme changes, which is when the text vanished.
//
// Only the editor calls the highlighter's public `setTheme` (Shiki tokenizes
// through its internal context), so resolving the placeholders there fixes
// the editor and touches nothing else.

type Replacements = Readonly<Record<string, string | undefined>>;

/** The colour map with Shiki's placeholders swapped for what they stand for. */
export function resolveColorMap(
  colorMap: readonly string[],
  replacements: Replacements = {}
): string[] {
  // The registry upper-cases hex colours; Shiki keys replacements lower-case.
  return colorMap.map((color) => replacements[color.toLowerCase()] ?? color);
}

const resolved = new WeakSet<DiffsHighlighter>();

/** Makes `highlighter.setTheme` return a colour map the editor can paint with. */
export function resolveEditorColors(highlighter: DiffsHighlighter): void {
  if (resolved.has(highlighter)) {
    return;
  }
  resolved.add(highlighter);
  const setTheme = highlighter.setTheme.bind(highlighter);
  highlighter.setTheme = (name) => {
    const active = setTheme(name);
    return {
      ...active,
      colorMap: resolveColorMap(
        active.colorMap,
        active.theme.colorReplacements
      ),
    };
  };
}

/**
 * Resolves the editor's colours on the shared highlighter (@pierre/diffs
 * keeps one per page), creating it if need be. Call it before an editor
 * mounts: the editor's first tokenizing pass reads the colour map. Browser
 * only; a no-op on the server, where nothing is edited.
 */
export function prepareEditorColors(): void {
  if (typeof window === "undefined") {
    return;
  }
  const loaded = getHighlighterIfLoaded();
  if (loaded) {
    resolveEditorColors(loaded);
    return;
  }
  getSharedHighlighter({
    langs: ["text"],
    themes: [codeThemeNames.light, codeThemeNames.dark],
  }).then(resolveEditorColors, () => {
    // The editor asks for the same highlighter and reports its own failure.
  });
}
