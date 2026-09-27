import { createRequire } from "node:module";

import { getConfig } from "@lingui/conf";
import babel from "@rolldown/plugin-babel";
import { playwright } from "@vitest/browser-playwright";
import { defineProject } from "vitest/config";

const require = createRequire(import.meta.url);

// The one Lingui config lives in @workspace/i18n (one catalog for every app).
const linguiConfig = getConfig({
  configPath: require.resolve("@workspace/i18n/lingui.config"),
});

// Real, headless Chromium (AGENTS.md "Testing"): shortcuts are about real
// keyboard events, focus and text fields, which jsdom only imitates. The pure
// registry and key helpers run there too, so `vitest run` stays one command.
export default defineProject({
  // Pre-bundle up front: discovering these mid-run reloads the page and fails
  // whichever test file was importing. `a > b` resolves b from package a.
  optimizeDeps: {
    include: [
      "@lingui/core",
      "@lingui/react",
      "@tanstack/react-hotkeys",
      "@testing-library/react",
      "react",
      "react-dom",
      "react-dom/client",
      "react/jsx-dev-runtime",
      "react/jsx-runtime",
      "zod",
      "@workspace/ui > @workspace/icons > lucide-react",
      "@workspace/ui > @base-ui/react/button",
      "@workspace/ui > @base-ui/react/dialog",
      "@workspace/ui > class-variance-authority",
      "@workspace/ui > cn",
    ],
  },
  plugins: [
    // Lingui macros compile away at build time; Next does it with the SWC
    // plugin, Vite needs the Babel one.
    babel({
      plugins: [["@lingui/babel-plugin-lingui-macro", { linguiConfig }]],
    }),
  ],
  test: {
    browser: {
      enabled: true,
      headless: true,
      instances: [{ browser: "chromium" }],
      provider: playwright(),
      screenshotFailures: false,
    },
    include: ["src/**/*.test.{ts,tsx}"],
    name: "shortcuts",
  },
});
