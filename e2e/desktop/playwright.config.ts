import { defineConfig } from "@playwright/test";

import { desktopBaseUrl, desktopPort } from "./port";

// The desktop shell's smoke test (ticket 116): the built app (apps/desktop)
// launched by Playwright's Electron support against the same server the web
// suite uses (e2e/support/serve.ts: the production build of apps/web, an
// embedded database in a temporary directory, the mock model server). Its
// own port, so it never meets a web suite run. `bun turbo test:desktop`
// builds both apps first; e2e/desktop/run.ts skips it off macOS.
export default defineConfig({
  expect: { timeout: 20_000 },
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: false,
  outputDir: "../test-results/desktop",
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  retries: 0,
  testDir: ".",
  testMatch: /\.spec\.ts$/,
  timeout: 120_000,
  use: { trace: "retain-on-failure" },
  webServer: {
    command: "bun ../support/serve.ts",
    env: { ...process.env, E2E_PORT: String(desktopPort) },
    // SIGTERM, so serve.ts deletes its temporary directory.
    gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
    // A fresh server every run: the smoke test makes the first account.
    reuseExistingServer: false,
    stdout: "pipe",
    timeout: 300_000,
    url: `${desktopBaseUrl}/api/config`,
  },
  workers: 1,
});
