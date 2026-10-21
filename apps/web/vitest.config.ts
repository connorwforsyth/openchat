import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { getConfig } from "@lingui/conf";
import babel from "@rolldown/plugin-babel";
import { playwright } from "@vitest/browser-playwright";
import { defineProject } from "vitest/config";

const require = createRequire(import.meta.url);

const TEST_FILES = ["app/**/*.test.{ts,tsx}", "lib/**/*.test.ts"];

// The one Lingui config lives in @workspace/i18n (one catalog for every app).
const linguiConfig = getConfig({
  configPath: require.resolve("@workspace/i18n/lingui.config"),
});

// Component tests for the web app's own pages (settings and admin) run in a
// real, headless Chromium with the API client over a fake `fetch`. Route and
// server code stays out: Playwright covers it against a production build.
export default defineProject({
  // Vitest gives Vite each test file's path as a dependency-scan entry, and
  // Vite reads entries as globs. A route group's parentheses, as in `(app)`,
  // then match nothing, so the scan misses those tests' imports and Vite finds
  // them mid-run. That reloads the page and fails whichever test file was
  // loading. These globs do match route groups.
  optimizeDeps: { entries: TEST_FILES },
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
    include: TEST_FILES,
    // One Chromium per package, two tabs in it (Vitest's default is a tab per
    // core): six packages each opening nine tabs starved the machine and
    // tabs failed to connect (ticket 043). The same on a laptop and on CI.
    maxWorkers: 2,
    name: "web",
    setupFiles: ["./vitest.setup.ts"],
    // Loaded CI runners are several times slower than a laptop (ticket 035).
    testTimeout: 30_000,
  },
});
