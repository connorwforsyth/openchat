import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    // The handler tests migrate a PGlite database once per worker.
    hookTimeout: 60_000,
    include: ["src/**/*.test.ts"],
    name: "sandbox",
  },
});
