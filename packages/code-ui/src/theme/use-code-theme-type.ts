"use client";

import type { ThemeTypes } from "@pierre/diffs";
import { useTheme } from "next-themes";

import type { CodeThemeType } from "./code-theme";

/**
 * The colour scheme the app resolved (next-themes' `.dark` class), so the
 * libraries' own `light-dark()` fallbacks agree with the tokens. Before
 * hydration, or without a ThemeProvider, the system preference stands in.
 */
export function useCodeThemeType(): {
  readonly scheme: CodeThemeType;
  readonly themeType: ThemeTypes;
} {
  const { resolvedTheme } = useTheme();
  if (resolvedTheme === "dark" || resolvedTheme === "light") {
    return { scheme: resolvedTheme, themeType: resolvedTheme };
  }
  return { scheme: "light", themeType: "system" };
}
