import { fileURLToPath } from "node:url";

import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    // Migrates one PGlite before the workers start; each test clones it.
    globalSetup: [
      fileURLToPath(import.meta.resolve("@workspace/db/testing-setup")),
    ],
    hookTimeout: 60_000,
    include: ["src/**/*.test.ts"],
    name: "auth",
  },
});
