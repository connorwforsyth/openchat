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

// Component tests run in a real, headless Chromium (AGENTS.md "Testing"),
// like the composer's: dialogs, focus and menus behave as they do for
// people. The pure helpers run there too; one project keeps `vitest run` a
// single command.
export default defineProject({
  // Pre-bundle up front: discovering these mid-run reloads the page and fails
  // whichever test file was importing. `a > b` resolves b from package a
  // (bun's isolated installs keep each package's dependencies to itself).
  optimizeDeps: {
    include: [
      "@lingui/core",
      "@lingui/react",
      "@tanstack/react-query",
      "@testing-library/react",
      "react",
      "react-dom",
      "react-dom/client",
      "react/jsx-dev-runtime",
      "react/jsx-runtime",
      "zod",
      "@workspace/shared > uuidv7",
      "@workspace/icons > lucide-react",
      "@workspace/ui > @base-ui/react/alert-dialog",
      "@workspace/ui > @base-ui/react/button",
      "@workspace/ui > @base-ui/react/checkbox",
      "@workspace/ui > @base-ui/react/dialog",
      "@workspace/ui > @base-ui/react/input",
      "@workspace/ui > @base-ui/react/menu",
      "@workspace/ui > @base-ui/react/merge-props",
      "@workspace/ui > @base-ui/react/preview-card",
      "@workspace/ui > @base-ui/react/select",
      "@workspace/ui > @base-ui/react/separator",
      "@workspace/ui > @base-ui/react/tabs",
      "@workspace/ui > @base-ui/react/toggle",
      "@workspace/ui > @base-ui/react/toggle-group",
      "@workspace/ui > @base-ui/react/tooltip",
      "@workspace/ui > @base-ui/react/use-render",
      "@workspace/ui > @shadcn/react/message-scroller",
      "@workspace/ui > class-variance-authority",
      "@workspace/ui > cn",
      "@workspace/ui > nanoid",
      "@workspace/ui > streamdown",
      "@workspace/code-ui > @pierre/diffs",
      "@workspace/code-ui > @pierre/diffs/react",
      "@workspace/code-ui > @pierre/trees",
      "@workspace/code-ui > next-themes",
      "@workspace/client > @ai-sdk/react",
    ],
  },
  plugins: [
    // Lingui macros (`t`, `<Trans>`) compile away at build time; Next does it
    // with the SWC plugin, Vite needs the Babel one.
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
    name: "library-ui",
    setupFiles: ["./src/testing/setup.ts"],
  },
});
