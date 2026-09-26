import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    // Persist and fork tests clone a migrated PGlite; migrate it once per run.
    globalSetup: ["../db/src/testing-setup.ts"],
    // Cloning a PGlite on a loaded CI runner can pass the 10s default.
    hookTimeout: 60_000,
    include: ["src/**/*.test.ts"],
    name: "importers",
    // PGlite on shared CI runners is several times slower than a laptop.
    testTimeout: 30_000,
  },
});
