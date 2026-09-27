import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    // The handler tests migrate a PGlite database once per worker.
    hookTimeout: 60_000,
    include: ["src/**/*.test.ts"],
    name: "sandbox",
    // Loaded CI runners are several times slower than a laptop (ticket 035).
    testTimeout: 30_000,
  },
});
