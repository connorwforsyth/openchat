import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Ticket 035: every package's tests run on loaded CI runners, where Vitest's
// 5 s default timed out suite after suite. New packages must opt in too.
const TEST_TIMEOUT = /testTimeout:\s*[\d_]+/;
const HOOK_TIMEOUT = /hookTimeout:\s*[\d_]+/;

const root = join(import.meta.dirname, "..", "..");
const configs = ["apps", "packages"].flatMap((dir) =>
  readdirSync(join(root, dir))
    .map((name) => join(dir, name, "vitest.config.ts"))
    .filter((config) => existsSync(join(root, config)))
);

describe("vitest configs", () => {
  it("finds the package configs", () => {
    expect(configs.length).toBeGreaterThan(10);
  });

  it.each(configs)("%s sets CI-safe timeouts", (config) => {
    const source = readFileSync(join(root, config), "utf8");
    expect(source).toMatch(TEST_TIMEOUT);
    expect(source).toMatch(HOOK_TIMEOUT);
  });
});
