import { defineConfig } from "vitest/config";

// One Vitest run across the monorepo: every app or package with its own
// vitest.config.ts becomes a project, plus the repo guards in scripts/ci.
// Turbo still runs each package's `test` script separately so results cache
// per package.
//
// `ai`, `sandbox` and `server` only hold port interfaces and their fakes so
// far (ticket 005), and may not carry config of their own yet. The
// workstream that fills each one adds its vitest.config.ts and drops its
// entry here.
const portShells = ["ai", "sandbox", "server"].map((name) => ({
  test: { include: ["src/**/*.test.ts"], name, root: `packages/${name}` },
}));

export default defineConfig({
  test: {
    projects: [
      "apps/*/vitest.config.ts",
      "packages/*/vitest.config.ts",
      "scripts/ci/vitest.config.ts",
      ...portShells,
    ],
  },
});
