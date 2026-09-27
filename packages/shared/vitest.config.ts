import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    hookTimeout: 60_000,
    include: ["src/**/*.test.ts"],
    name: "shared",
    // Loaded CI runners are several times slower than a laptop (ticket 035).
    testTimeout: 30_000,
  },
});
