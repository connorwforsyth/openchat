import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

// Ticket 035: every package's tests run on loaded CI runners, where Vitest's
// 5 s default timed out suite after suite. New packages must opt in too.
const TEST_TIMEOUT = /testTimeout:\s*[\d_]+/;
const HOOK_TIMEOUT = /hookTimeout:\s*[\d_]+/;

// Ticket 043: turbo starts every browser-mode package at once beside the
// builds. Each must queue on the machine-wide lock, cap its tabs, keep
// Chromium's network service in-process and give a starved Chromium time to
// connect, or loaded runs fail to connect.
const BROWSER_MODE = /browser:\s*\{[^}]*enabled:\s*true/;
const CONNECT_TIMEOUT = /connectTimeout:\s*([\d_]+)/;
const MAX_WORKERS = /maxWorkers:\s*(\d+)/;
const NETWORK_IN_PROCESS = /--enable-features=[\w,]*NetworkServiceInProcess2/;
const MIN_CONNECT_TIMEOUT = 600_000;
const MAX_TABS = 4;
const LOCKED_TEST_SCRIPT = "bun ../../scripts/ci/browser-lock.ts vitest run";

const toNumber = (digits: string | undefined): number =>
  Number((digits ?? "").replaceAll("_", ""));

const root = join(import.meta.dirname, "..", "..");
const configs: readonly string[] = ["apps", "packages"].flatMap((dir) =>
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

const browserConfigs = configs.filter((config) =>
  BROWSER_MODE.test(readFileSync(join(root, config), "utf8"))
);

describe("browser-mode vitest configs", () => {
  it("finds the browser packages", () => {
    expect(browserConfigs.length).toBeGreaterThan(4);
  });

  it.each(browserConfigs)("%s survives a parallel turbo run", (config) => {
    const source = readFileSync(join(root, config), "utf8");
    expect(
      toNumber(source.match(CONNECT_TIMEOUT)?.[1]),
      "connectTimeout"
    ).toBeGreaterThanOrEqual(MIN_CONNECT_TIMEOUT);
    expect(source).toMatch(NETWORK_IN_PROCESS);
    const maxWorkers = toNumber(source.match(MAX_WORKERS)?.[1]);
    expect(maxWorkers, "maxWorkers").toBeGreaterThan(0);
    expect(maxWorkers, "maxWorkers").toBeLessThanOrEqual(MAX_TABS);

    const manifest = JSON.parse(
      readFileSync(join(root, dirname(config), "package.json"), "utf8")
    ) as { scripts?: Record<string, string> };
    expect(manifest.scripts?.test).toBe(LOCKED_TEST_SCRIPT);
  });
});
