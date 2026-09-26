import { registerCustomTheme } from "@pierre/diffs";

import { codeThemeNames, createCodeTheme } from "./code-theme";

// @pierre/diffs resolves themes by name from its own registry, and logs an
// error when a name is registered twice (module re-evaluation under HMR, or
// two entry points importing this file), hence the guard.
let registered = false;

/** Registers the generated light and dark themes with @pierre/diffs, once. */
export function registerCodeThemes(): void {
  if (registered) {
    return;
  }
  registered = true;
  for (const type of ["light", "dark"] as const) {
    const theme = createCodeTheme(type);
    registerCustomTheme(codeThemeNames[type], () => Promise.resolve(theme));
  }
}
