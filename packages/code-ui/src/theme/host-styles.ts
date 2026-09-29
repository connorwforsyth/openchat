import type { ThemeTypes } from "@pierre/diffs";
import { themeToTreeStyles } from "@pierre/trees";
import type { CSSProperties } from "react";

import { type CodeThemeType, createCodeTheme } from "./code-theme";

// Both libraries render into a shadow root and read `--diffs-*` / `--trees-*`
// custom properties, which inherit through it. Setting them on the host maps
// the libraries' chrome onto the `packages/ui` tokens; the generated Shiki
// theme covers syntax and diff colours.

type CustomProperties = Readonly<Record<`--${string}`, string>>;

/** `--diffs-*` overrides for the file and diff hosts. */
const diffsOverrides: CSSProperties = {
  "--diffs-bg-buffer-override": "var(--muted)",
  "--diffs-bg-separator-override": "var(--muted)",
  "--diffs-fg-number-override": "var(--muted-foreground)",
  "--diffs-font-family": "var(--font-mono)",
  "--diffs-header-font-family": "var(--font-sans)",
  // The library mixes backgrounds towards black or white by colour scheme;
  // mixing towards the foreground token follows the theme instead.
  "--diffs-mixer": "var(--foreground)",
} satisfies CustomProperties as CSSProperties;

// The library's `light-dark()` mixes (diff tints, selection, hover) follow the
// host's `color-scheme`, which it writes into the shadow root. While a file is
// being edited it writes the scheme the editor last tokenized in, recorded
// after the render that applies it, so it lags one switch behind the app
// (064). The host's own style outranks the shadow root's `:host` rule, so
// pinning the scheme here keeps every view on the app's. "system" leaves it
// to the library (before hydration, when the app's scheme isn't known yet).
const diffsHostStyles: Readonly<Record<ThemeTypes, CSSProperties>> = {
  dark: { ...diffsOverrides, colorScheme: "dark" },
  light: { ...diffsOverrides, colorScheme: "light" },
  system: diffsOverrides,
};

/** Host style for the file and diff views in the given colour scheme. */
export function diffsHostStyle(themeType: ThemeTypes): CSSProperties {
  return diffsHostStyles[themeType];
}

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
