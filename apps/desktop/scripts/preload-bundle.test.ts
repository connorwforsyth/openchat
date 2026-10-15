import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import type { InstanceBridge } from "../src/preload/instance";
import type { SetupBridge } from "../src/preload/setup";
import { checkPreload } from "./preload-bundle";

// The built preloads (turbo builds the shell before this test) must load in
// a sandbox and expose exactly their bridge (148). The key lists are typed
// against the bridges, so adding a method without listing it fails to compile.

const built = (name: string): string => {
  const path = resolve(import.meta.dirname, `../dist/preload/${name}.cjs`);
  if (!existsSync(path)) {
    throw new Error(
      `${path} is missing: run \`bun run build\` in apps/desktop first`
    );
  }
  return readFileSync(path, "utf8");
};

const keysOf = <T>(keys: Record<keyof T, true>): string[] =>
  Object.keys(keys).sort();

const INSTANCE = keysOf<InstanceBridge>({
  hideQuickAi: true,
  onMenuCommand: true,
  platform: true,
});
const SETUP = keysOf<SetupBridge>({
  connect: true,
  current: true,
  platform: true,
});

describe("built preloads", () => {
  it("the instance preload loads sandboxed and exposes only window.desktop", () => {
    expect(checkPreload(built("instance"))).toEqual({
      exposed: { desktop: INSTANCE },
      ok: true,
    });
  });

  it("the setup preload loads sandboxed and exposes only window.desktopSetup", () => {
    expect(checkPreload(built("setup"))).toEqual({
      exposed: { desktopSetup: SETUP },
      ok: true,
    });
  });
});

describe("checkPreload", () => {
  it("refuses a bundle that requires a Node built-in", () => {
    const result = checkPreload('const fs = require("node:fs");');
    expect(result.ok).toBe(false);
  });

  it("refuses a dynamic import", () => {
    const result = checkPreload('import("./later.js");');
    expect(result).toMatchObject({ ok: false });
  });

  it("allows Electron and the polyfilled built-ins", () => {
    const result = checkPreload(
      'const { contextBridge } = require("electron"); require("events"); contextBridge.exposeInMainWorld("x", { a: 1 });'
    );
    expect(result).toEqual({ exposed: { x: ["a"] }, ok: true });
  });
});
