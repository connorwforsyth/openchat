import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    // `evals/` holds the Evalite suites (`bun turbo eval`) and tests for their scorers.
    include: ["src/**/*.test.ts", "evals/**/*.test.ts"],
    name: "ai",
  },
});
