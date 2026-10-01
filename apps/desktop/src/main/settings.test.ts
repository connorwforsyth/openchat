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
    expect(await readSettings(settingsPath(dir))).toEqual({ instance: null });
  });

  it("round-trips the chosen instance", async () => {
    const path = settingsPath(join(dir, "nested"));
    const instance = { name: "Team Chat", origin: "https://chat.example.com" };
    await writeSettings(path, { instance });
    expect(await readSettings(path)).toEqual({ instance });
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ instance });
  });

  it("falls back to defaults on a corrupt or foreign file", async () => {
    const path = settingsPath(dir);
    await writeFile(path, "{not json");
    expect(await readSettings(path)).toEqual({ instance: null });
    await writeFile(path, JSON.stringify({ instance: { origin: 42 } }));
    expect(await readSettings(path)).toEqual({ instance: null });
  });
});
