import { defineProject } from "vitest/config";

// The transform, the module loader and the headers are pure, so they run in
// Node; rendering is checked with react-dom/server rather than a browser.
export default defineProject({
  test: {
    hookTimeout: 60_000,
    include: ["src/**/*.test.ts"],
    name: "artifacts",
    // Loaded CI runners are several times slower than a laptop (ticket 035).
    testTimeout: 30_000,
  },
});
