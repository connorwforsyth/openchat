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

// Component tests run in a real, headless Chromium (AGENTS.md "Testing"):
// keyboard shortcuts, focus, menus and popovers need a real browser. The pure
// models run there too, so `vitest run` stays one command, as in `composer`.
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
      "diff",
      "react",
      "react-dom",
      "react-dom/client",
      "react/jsx-dev-runtime",
      "react/jsx-runtime",
      "zod",
      "@streamdown/math",
      "@pierre/diffs",
      "@workspace/code-ui > @pierre/diffs",
      "@workspace/code-ui > @pierre/diffs/edit",
      "@workspace/code-ui > @pierre/diffs/react",
      "@workspace/code-ui > @pierre/trees",
      "@workspace/code-ui > @pierre/trees/react",
      "@workspace/code-ui > next-themes",
      "@workspace/composer > @tiptap/core",
      "@workspace/composer > @tiptap/extension-code",
      "@workspace/composer > @tiptap/extension-document",
      "@workspace/composer > @tiptap/extension-hard-break",
      "@workspace/composer > @tiptap/extension-mention",
      "@workspace/composer > @tiptap/extension-paragraph",
      "@workspace/composer > @tiptap/extension-placeholder",
      "@workspace/composer > @tiptap/extension-text",
      "@workspace/composer > @tiptap/extensions",
      "@workspace/composer > @tiptap/pm/state",
      "@workspace/composer > @tiptap/react",
      "@workspace/composer > @tiptap/suggestion",
      "@workspace/client > @orpc/client",
      "@workspace/client > @orpc/openapi-client/fetch",
      "@workspace/client > @orpc/tanstack-query",
      "@workspace/contract > @orpc/contract",
      "@workspace/shared > uuidv7",
      "@workspace/shortcuts > @tanstack/react-hotkeys",
      "@workspace/icons > lucide-react",
      "@workspace/ui > @base-ui/react/avatar",
      "@workspace/ui > @base-ui/react/button",
      "@workspace/ui > @base-ui/react/checkbox",
      "@workspace/ui > @base-ui/react/collapsible",
      "@workspace/ui > @base-ui/react/dialog",
      "@workspace/ui > @base-ui/react/drawer",
      "@workspace/ui > @base-ui/react/input",
      "@workspace/ui > @base-ui/react/menu",
      "@workspace/ui > @base-ui/react/merge-props",
      "@workspace/ui > @base-ui/react/popover",
      "@workspace/ui > @base-ui/react/preview-card",
      "@workspace/ui > @base-ui/react/select",
      "@workspace/ui > @base-ui/react/separator",
      "@workspace/ui > @base-ui/react/tabs",
      "@workspace/ui > @base-ui/react/toast",
      "@workspace/ui > @base-ui/react/tooltip",
      "@workspace/ui > @base-ui/react/use-render",
      "@workspace/ui > @shadcn/react/message-scroller",
      "@workspace/ui > class-variance-authority",
      "@workspace/ui > cn",
      "@workspace/ui > nanoid",
      "@workspace/ui > react-resizable-panels",
      "@workspace/ui > streamdown",
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
      // Beside turbo's typechecks, lints and builds on a loaded machine,
      // launching Chromium alone took three to four minutes (ticket 043); on
      // an idle one it takes a second. Vitest's default is 60 s.
      connectTimeout: 600_000,
      enabled: true,
      headless: true,
      instances: [{ browser: "chromium" }],
      provider: playwright({
        // Chromium's network service normally runs as a child process that
        // exits if the browser hasn't connected to it within 15 s. On a
        // starved machine that happens, and the browser took minutes to
        // notice and restart it, so no tab connected (ticket 043). In the
        // browser process there is no handshake to miss. Playwright's own
        // feature is repeated: Chromium reads only the last --enable-features.
        launchOptions: {
          args: [
            "--enable-features=CDPScreenshotNewSurface,NetworkServiceInProcess2",
          ],
        },
      }),
      screenshotFailures: false,
      // A desktop-sized frame by default (Vitest's is phone-sized, which is
      // below `md` and gets the sheets); the narrow-screen tests resize it.
      viewport: { height: 800, width: 1280 },
    },
    hookTimeout: 60_000,
    include: ["src/**/*.test.{ts,tsx}"],
    // One Chromium per package, two tabs in it (Vitest's default is a tab per
    // core): six packages each opening nine tabs starved the machine and
    // tabs failed to connect (ticket 043). The same on a laptop and on CI.
    maxWorkers: 2,
    name: "chat-ui",
    setupFiles: ["./vitest.setup.ts"],
    // Headroom for a busy CI runner running every package at once. Tests
    // don't wait on lazy chunks or Shiki (ticket 037): they warm chunks in
    // `beforeAll` (hookTimeout) or render synchronous stand-ins, and the one
    // test on the real lazy diff path sets its own, longer timeout.
    testTimeout: 30_000,
  },
});
