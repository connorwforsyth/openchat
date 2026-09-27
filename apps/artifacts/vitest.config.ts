import { defineProject } from "vitest/config";

// The transform, the module loader and the headers are pure, so they run in
// Node; rendering is checked with react-dom/server rather than a browser.
export default defineProject({
  test: {
    include: ["src/**/*.test.ts"],
    name: "artifacts",
  },
});
