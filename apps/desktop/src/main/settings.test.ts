import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readSettings, settingsPath, writeSettings } from "./settings";

let dir = "";
const quickAi = { shortcut: "Alt+Space" };

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
      quickAi,
      window: null,
    });
  });

  it("round-trips the chosen instance", async () => {
    const path = settingsPath(join(dir, "nested"));
    const instance = { name: "Team Chat", origin: "https://chat.example.com" };
    await writeSettings(path, { instance, quickAi, window: null });
    expect(await readSettings(path)).toEqual({
      instance,
      quickAi,
      window: null,
    });
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
      instance,
      quickAi,
      window: null,
    });
  });

  it("falls back to defaults on a corrupt or foreign file", async () => {
    const path = settingsPath(dir);
    const defaults = { instance: null, quickAi, window: null };
    await writeFile(path, "{not json");
    expect(await readSettings(path)).toEqual(defaults);
    await writeFile(path, JSON.stringify({ instance: { origin: 42 } }));
    expect(await readSettings(path)).toEqual(defaults);
  });

  it("round-trips the window's bounds", async () => {
    const path = settingsPath(dir);
    const window = { height: 900, maximized: true, width: 1400, x: 10, y: 40 };
    await writeSettings(path, { instance: null, quickAi, window });
    expect(await readSettings(path)).toEqual({
      instance: null,
      quickAi,
      window,
    });
  });

  it("drops unreadable bounds but keeps the instance", async () => {
    const path = settingsPath(dir);
    const instance = { name: "Team Chat", origin: "https://chat.example.com" };
    await writeFile(path, JSON.stringify({ instance, window: { x: "left" } }));
    expect(await readSettings(path)).toEqual({
      instance,
      quickAi,
      window: null,
    });
  });

  it("reads the Quick AI shortcut: a combo, none, or the default", async () => {
    const path = settingsPath(dir);
    const read = async (value: unknown) => {
      await writeFile(path, JSON.stringify({ quickAi: value }));
      return (await readSettings(path)).quickAi;
    };
    expect(await read({ shortcut: "Mod+Shift+Space" })).toEqual({
      shortcut: "Mod+Shift+Space",
    });
    expect(await read({ shortcut: null })).toEqual({ shortcut: null });
    // Kept as written: main explains what's wrong with it.
    expect(await read({ shortcut: "Hyper+Q" })).toEqual({
      shortcut: "Hyper+Q",
    });
    expect(await read({ shortcut: 7 })).toEqual(quickAi);
    expect(await read("Alt+Space")).toEqual(quickAi);
    expect(await read(undefined)).toEqual(quickAi);
  });
});
