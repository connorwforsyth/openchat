import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://localhost:${port}`;

// End to end (PLAN.md §11 M1) against the production build of apps/web, the
// server the Docker image runs, on an empty environment: the embedded
// database in a temporary directory and a mock OpenAI-compatible model
// server (e2e/support/serve.ts). `bun turbo test:e2e` builds apps/web first.
//
// One worker, in order: the specs share one server and one database, and the
// first sign-up (accounts.setup.ts) makes the admin everything else needs.
export default defineConfig({
  expect: { timeout: 20_000 },
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: false,
  globalTeardown: "./e2e/support/print-timings.ts",
  outputDir: "./e2e/test-results",
  projects: [
    {
      name: "setup",
      testMatch: /\.setup\.ts$/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      dependencies: ["setup"],
      name: "chromium",
      testMatch: /\.spec\.ts$/,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  retries: 0,
  testDir: "./e2e/tests",
  timeout: 90_000,
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "bun e2e/support/serve.ts",
    // Never reuse one: it would already have users, and the first sign-up
    // has to be the first.
    reuseExistingServer: false,
    stdout: "pipe",
    timeout: 300_000,
    // An API route, so "ready" means booted: the server opens and migrates
    // the embedded database on the first API request.
    url: `${baseURL}/api/config`,
  },
  workers: 1,
});
