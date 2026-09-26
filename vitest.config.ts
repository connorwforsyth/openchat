import { defineConfig } from "vitest/config";

// One Vitest run across the monorepo: every app or package with its own
// vitest.config.ts becomes a project, plus the repo guards in scripts/ci.
// Turbo still runs each package's `test` script separately so results cache
// per package.
export default defineConfig({
  test: {
    projects: [
      "apps/*/vitest.config.ts",
      "packages/*/vitest.config.ts",
      "scripts/ci/vitest.config.ts",
    ],
  },
});
