import { defineConfig } from "evalite/config";
import { createInMemoryStorage } from "evalite/in-memory-storage";

// Dev evals (D21) run on recorded fixtures in CI (`bun turbo eval`). Every
// case is pass/fail, so anything under 100% is a regression and fails the
// run. Results stay in memory: CI keeps nothing, and the default SQLite
// store would need a native module we don't otherwise ship.

export default defineConfig({
  scoreThreshold: 100,
  storage: () => createInMemoryStorage(),
});
