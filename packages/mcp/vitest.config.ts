import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    // Token storage tests run on PGlite: migrate once, clone per worker.
    globalSetup: ["../db/src/testing-setup.ts"],
    hookTimeout: 60_000,
    include: ["src/**/*.test.ts"],
    name: "mcp",
  },
});
