import { playwright } from "@vitest/browser-playwright";
import { defineProject } from "vitest/config";

// The layouts render in a real, headless Chromium (AGENTS.md "Testing"),
// with the settings every browser-mode package shares (tickets 035 and 043).
export default defineProject({
  // Pre-bundle up front: discovering these mid-run reloads the page and fails
  // whichever test file was importing.
  optimizeDeps: {
    include: [
      "@testing-library/react",
      "react",
      "react-dom",
      "react-dom/client",
      "react/jsx-dev-runtime",
      "react/jsx-runtime",
    ],
  },
  test: {
    browser: {
      // Launching Chromium beside turbo's other tasks on a loaded machine
      // can take minutes (ticket 043).
      connectTimeout: 600_000,
      enabled: true,
      headless: true,
      instances: [{ browser: "chromium" }],
      provider: playwright({
        // The network service in the browser process: no child-process
        // handshake to miss on a starved machine (ticket 043).
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
    // One Chromium per package, two tabs in it (ticket 043).
    maxWorkers: 2,
    name: "slide-ui",
    setupFiles: ["./vitest.setup.ts"],
    // Loaded CI runners are several times slower than a laptop (ticket 035).
    testTimeout: 30_000,
  },
});
