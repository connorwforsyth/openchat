import { defineProject } from "vitest/config";

// The harness's own pure parts (matching, outcomes, reports). The evals
// themselves aren't Vitest tests: `bun run evals` runs them against a
// booted server.
export default defineProject({
  test: {
    hookTimeout: 60_000,
    include: ["src/**/*.test.ts"],
    name: "evals",
    testTimeout: 30_000,
  },
});
