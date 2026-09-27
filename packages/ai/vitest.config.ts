import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    hookTimeout: 60_000,
    // `evals/` holds the Evalite suites (`bun turbo eval`) and tests for their scorers.
    include: ["src/**/*.test.ts", "evals/**/*.test.ts"],
    name: "ai",
    // Loaded CI runners are several times slower than a laptop (ticket 035).
    testTimeout: 30_000,
  },
});
