import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { getConfig } from "@lingui/conf";
import babel from "@rolldown/plugin-babel";
import { playwright } from "@vitest/browser-playwright";
import { defineProject } from "vitest/config";

const require = createRequire(import.meta.url);

// The one Lingui config lives in @workspace/i18n (one catalog for every app).
const linguiConfig = getConfig({
  configPath: require.resolve("@workspace/i18n/lingui.config"),
});

// Component tests for the web app's own pages (settings and admin) run in a
// real, headless Chromium with the API client over a fake `fetch`. Route and
// server code stays out: Playwright covers it against a production build.
export default defineProject({
  // Pre-bundle up front: discovering these mid-run reloads the page and fails
  // whichever test file was importing. `a > b` resolves b from package a.
  optimizeDeps: {
    include: [
      "@lingui/core",
      "@lingui/react",
      "@tanstack/react-query",
      "@testing-library/react",
      "next-themes",
      "next/link",
      "next/navigation",
      "react",
      "react-dom",
      "react-dom/client",
      "react/jsx-dev-runtime",
      "react/jsx-runtime",
      "zod",
      "@workspace/client > @orpc/client",
      "@workspace/client > @orpc/openapi-client/fetch",
      "@workspace/client > @orpc/tanstack-query",
      "@workspace/contract > @orpc/contract",
      "@workspace/shared > uuidv7",
      "@workspace/icons > lucide-react",
      "@workspace/shortcuts > @tanstack/react-hotkeys",
      "@workspace/ui > @base-ui/react/alert-dialog",
      "@workspace/ui > @base-ui/react/avatar",
      "@workspace/ui > @base-ui/react/button",
      "@workspace/ui > @base-ui/react/dialog",
      "@workspace/ui > @base-ui/react/input",
      "@workspace/ui > @base-ui/react/merge-props",
      "@workspace/ui > @base-ui/react/radio",
      "@workspace/ui > @base-ui/react/radio-group",
      "@workspace/ui > @base-ui/react/select",
      "@workspace/ui > @base-ui/react/separator",
      "@workspace/ui > @base-ui/react/switch",
      "@workspace/ui > @base-ui/react/toggle",
      "@workspace/ui > @base-ui/react/toggle-group",
      "@workspace/ui > @base-ui/react/use-render",
      "@workspace/ui > class-variance-authority",
      "@workspace/ui > cmdk",
      "@workspace/ui > cn",
    ],
  },
  // Next's tsconfig says `jsx: preserve` (Next compiles JSX itself); Vite
  // has to compile it here.
  oxc: { jsx: { runtime: "automatic" } },
  plugins: [
    // Lingui macros compile away at build time; Next does it with the SWC
    // plugin, Vite needs the Babel one.
    babel({
      plugins: [["@lingui/babel-plugin-lingui-macro", { linguiConfig }]],
    }),
  ],
  resolve: {
    alias: {
      "@/": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    browser: {
      enabled: true,
      headless: true,
      instances: [{ browser: "chromium" }],
      provider: playwright(),
      screenshotFailures: false,
    },
    hookTimeout: 60_000,
    include: ["app/**/*.test.{ts,tsx}"],
    name: "web",
    setupFiles: ["./vitest.setup.ts"],
    // Loaded CI runners are several times slower than a laptop (ticket 035).
    testTimeout: 30_000,
  },
});
