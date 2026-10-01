import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readSettings, settingsPath, writeSettings } from "./settings";

let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "desktop-settings-"));
});

afterEach(async () => {
  await rm(dir, { force: true, recursive: true });
});

describe("settings", () => {
  it("starts with no instance", async () => {
    expect(await readSettings(settingsPath(dir))).toEqual({
      instance: null,
      window: null,
    });
  });

  it("round-trips the chosen instance", async () => {
    const path = settingsPath(join(dir, "nested"));
    const instance = { name: "Team Chat", origin: "https://chat.example.com" };
    await writeSettings(path, { instance, window: null });
    expect(await readSettings(path)).toEqual({ instance, window: null });
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
      instance,
      window: null,
    });
  });

  it("falls back to defaults on a corrupt or foreign file", async () => {
    const path = settingsPath(dir);
    await writeFile(path, "{not json");
    expect(await readSettings(path)).toEqual({ instance: null, window: null });
    await writeFile(path, JSON.stringify({ instance: { origin: 42 } }));
    expect(await readSettings(path)).toEqual({ instance: null, window: null });
  });

  it("round-trips the window's bounds", async () => {
    const path = settingsPath(dir);
    const window = { height: 900, maximized: true, width: 1400, x: 10, y: 40 };
    await writeSettings(path, { instance: null, window });
    expect(await readSettings(path)).toEqual({ instance: null, window });
  });

  it("drops unreadable bounds but keeps the instance", async () => {
    const path = settingsPath(dir);
    const instance = { name: "Team Chat", origin: "https://chat.example.com" };
    await writeFile(path, JSON.stringify({ instance, window: { x: "left" } }));
    expect(await readSettings(path)).toEqual({ instance, window: null });
  });
});
