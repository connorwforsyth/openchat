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
// the composer leans on caret positions, paste, drag and drop and focus,
// which jsdom only imitates. The pure helpers run there too; one project
// keeps `vitest run` a single command.
export default defineProject({
  // Pre-bundle up front: discovering these mid-run reloads the page and fails
  // whichever test file was importing. `a > b` resolves b from package a
  // (bun's isolated installs keep each package's dependencies to itself).
  optimizeDeps: {
    include: [
      "@lingui/core",
      "@lingui/react",
      "@testing-library/react",
      "react",
      "react-dom",
      "react-dom/client",
      "react/jsx-dev-runtime",
      "react/jsx-runtime",
      "zod",
      "@workspace/shared > uuidv7",
      "@workspace/icons > lucide-react",
      "@workspace/ui > @base-ui/react/button",
      "@workspace/ui > @base-ui/react/input",
      "@workspace/ui > @base-ui/react/menu",
      "@workspace/ui > @base-ui/react/preview-card",
      "@workspace/ui > @base-ui/react/select",
      "@workspace/ui > @base-ui/react/tooltip",
      "@workspace/ui > class-variance-authority",
      "@workspace/ui > cn",
      "@workspace/ui > nanoid",
      "@tiptap/core",
      "@tiptap/extension-code",
      "@tiptap/extension-document",
      "@tiptap/extension-hard-break",
      "@tiptap/extension-mention",
      "@tiptap/extension-paragraph",
      "@tiptap/extension-placeholder",
      "@tiptap/extension-text",
      "@tiptap/extensions",
      "@tiptap/pm/state",
      "@tiptap/react",
      "@tiptap/suggestion",
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
    },
    hookTimeout: 60_000,
    include: ["src/**/*.test.{ts,tsx}"],
    // One Chromium per package, two tabs in it (Vitest's default is a tab per
    // core): six packages each opening nine tabs starved the machine and
    // tabs failed to connect (ticket 043). The same on a laptop and on CI.
    maxWorkers: 2,
    name: "composer",
    setupFiles: ["./vitest.setup.ts"],
    // Loaded CI runners are several times slower than a laptop (ticket 035).
    testTimeout: 30_000,
  },
});
