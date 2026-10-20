import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, devices } from "@playwright/test";

// Drives the instance scripts/launch.sh started (never one it didn't): no
// webServer here, the run dir says where it is. Evidence and traces land in
// <run dir>/evidence, which cleanup keeps.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const base = join(root, ".context/tmp/verify-web");
const runDir =
  process.env.VERIFY_RUN_DIR ??
  readFileSync(join(base, "active"), "utf8").trim();
const port = readFileSync(join(runDir, "port"), "utf8").trim();
process.env.VERIFY_RUN_DIR = runDir;

// The preset's user agent says Windows, and the app derives ⌘ or Ctrl from
// the user agent, while `ControlOrMeta` presses the host's key. The browser's
// own user agent keeps the two in step on any host.
const desktop = { ...devices["Desktop Chrome"], userAgent: undefined };

export default defineConfig({
  expect: { timeout: 30_000 },
  fullyParallel: false,
  outputDir: join(runDir, "evidence/test-results"),
  projects: [
    {
      name: "setup",
      testMatch: /accounts\.journey\.ts$/,
      use: desktop,
    },
    {
      dependencies: ["setup"],
      name: "journeys",
      testIgnore: /accounts\.journey\.ts$/,
      testMatch: /\.journey\.ts$/,
      use: desktop,
    },
  ],
  reporter: [["list"]],
  retries: 0,
  testDir: "./journeys",
  // Dev mode compiles each route on first visit.
  timeout: 180_000,
  use: {
    baseURL: `http://localhost:${port}`,
    screenshot: "on",
    trace: "retain-on-failure",
  },
  workers: 1,
});
