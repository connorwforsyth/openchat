import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    // Migrates one PGlite before the workers start (see @workspace/db/testing-setup).
    globalSetup: ["../db/src/testing-setup.ts"],
    hookTimeout: 60_000,
    include: ["src/**/*.test.ts"],
    name: "server",
    testTimeout: 30_000,
  },
});
