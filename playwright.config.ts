import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://localhost:${port}`;

// E2E runs against the production build of apps/web, the same server Docker ships.
export default defineConfig({
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: true,
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  reporter: process.env.CI ? "github" : "list",
  retries: process.env.CI ? 2 : 0,
  testDir: "./apps/web/e2e",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  webServer: {
    command: `bun run --filter web start --port ${port}`,
    reuseExistingServer: !process.env.CI,
    url: baseURL,
  },
});
