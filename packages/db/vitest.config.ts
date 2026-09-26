import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    globalSetup: ["src/testing-setup.ts"],
    // Cloning a PGlite is quick, but many at once on a loaded CI runner
    // (or a first migration against Postgres 17) can pass the 10s default.
    hookTimeout: 60_000,
    include: ["src/**/*.test.ts"],
    name: "db",
  },
});
