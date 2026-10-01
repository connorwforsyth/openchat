import { describe, expect, it } from "vitest";

import { parseDesktopBuild } from "./build-info";
import { startAutoUpdate, updateState } from "./updates";

describe("updateState", () => {
  it("is off unless the build turned it on", () => {
    expect(updateState({ autoUpdate: false }, true)).toEqual({
      kind: "off",
      reason: "build",
    });
  });

  it("is off in a dev run, which has no feed", () => {
    expect(updateState({ autoUpdate: true }, false)).toEqual({
      kind: "off",
      reason: "unpackaged",
    });
  });

  it("checks in a packaged build that turned it on", () => {
    expect(updateState({ autoUpdate: true }, true)).toEqual({
      kind: "checking",
    });
  });
});

describe("startAutoUpdate", () => {
  it("doesn't load the updater when off", async () => {
    // electron-updater needs Electron; importing it here would throw, so a
    // resolved "off" shows it was never loaded.
    await expect(startAutoUpdate({ autoUpdate: false }, true)).resolves.toEqual(
      { kind: "off", reason: "build" }
    );
  });
});

describe("parseDesktopBuild", () => {
  it("takes the build's values", () => {
    const build = { appId: "dev.example.app", autoUpdate: true, name: "Ex" };
    expect(parseDesktopBuild(build)).toEqual(build);
  });

  it("falls back when the define is missing", () => {
    expect(parseDesktopBuild(undefined)).toMatchObject({ autoUpdate: false });
  });
});
