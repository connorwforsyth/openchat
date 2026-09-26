import { defineConfig } from "@lingui/cli";
import { formatter } from "@lingui/format-po";

import { sourceLocale, supportedLocales } from "./src/locales";

// One catalog for the whole monorepo: shared packages use macros too (D12), so
// extraction scans every app and package, not just the one that renders them.
export default defineConfig({
  catalogs: [
    {
      exclude: ["**/node_modules/**", "**/.next/**", "**/dist/**"],
      include: ["<rootDir>/../../apps", "<rootDir>/../../packages"],
      path: "<rootDir>/locales/{locale}/messages",
    },
  ],
  // ES modules with types, so apps import catalogs without a bundler loader.
  compileNamespace: "ts",
  // Origins without line numbers: moving code shouldn't churn the catalog or
  // trip `i18n:check`.
  format: formatter({ lineNumbers: false }),
  locales: [...supportedLocales],
  sourceLocale,
});
