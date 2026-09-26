import { themeToTreeStyles } from "@pierre/trees";
import type { CSSProperties } from "react";

import { type CodeThemeType, createCodeTheme } from "./code-theme";

// Both libraries render into a shadow root and read `--diffs-*` / `--trees-*`
// custom properties, which inherit through it. Setting them on the host maps
// the libraries' chrome onto the `packages/ui` tokens; the generated Shiki
// theme covers syntax and diff colours.

type CustomProperties = Readonly<Record<`--${string}`, string>>;

/** `--diffs-*` overrides for the file and diff hosts. */
export const diffsHostStyle: CSSProperties = {
  "--diffs-bg-buffer-override": "var(--muted)",
  "--diffs-bg-separator-override": "var(--muted)",
  "--diffs-fg-number-override": "var(--muted-foreground)",
  "--diffs-font-family": "var(--font-mono)",
  "--diffs-header-font-family": "var(--font-sans)",
  // The library mixes backgrounds towards black or white by colour scheme;
  // mixing towards the foreground token follows the theme instead.
  "--diffs-mixer": "var(--foreground)",
} satisfies CustomProperties as CSSProperties;

/**
 * Host style for the file tree: the trees skill's `themeToTreeStyles` over the
 * generated theme, plus the pieces a Shiki theme can't express (accent, font,
 * radius).
 */
export function treeHostStyle(type: CodeThemeType): CSSProperties {
  return {
    ...themeToTreeStyles(createCodeTheme(type)),
    "--trees-accent-override": "var(--ring)",
    "--trees-bg-muted-override": "var(--sidebar-accent)",
    "--trees-border-radius-override": "var(--radius-md)",
    "--trees-font-family-override": "var(--font-sans)",
    "--trees-git-ignored-color-override": "var(--muted-foreground)",
    "--trees-git-renamed-color-override": "var(--chart-3)",
    "--trees-git-untracked-color-override": "var(--success, var(--chart-2))",
    "--trees-input-bg-override": "var(--background)",
    "--trees-search-bg-override": "var(--background)",
    "--trees-selected-focused-border-color-override": "var(--ring)",
    borderColor: "var(--sidebar-border)",
  } as CSSProperties;
}
