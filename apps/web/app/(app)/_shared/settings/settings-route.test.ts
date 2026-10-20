import { describe, expect, it } from "vitest";

import {
  closeSettings,
  openSettings,
  type SettingsHistory,
  selectSettingsSection,
  settingsRouteFromPath,
} from "./settings-route";

/** An in-memory history: a stack of entries and an index. */
const fakeHistory = (path: string, state: unknown = null) => {
  const entries: { state: unknown; url: string }[] = [{ state, url: path }];
  let index = 0;
  const history: SettingsHistory & { readonly url: () => string } = {
    back: () => {
      index = Math.max(0, index - 1);
    },
    pushState: (data, _unused, url) => {
      entries.splice(index + 1);
      entries.push({ state: data, url });
      index = entries.length - 1;
    },
    replaceState: (data, _unused, url) => {
      entries[index] = { state: data, url };
    },
    get state() {
      return entries[index]?.state;
    },
    url: () => entries[index]?.url ?? "",
  };
  return history;
};

describe("settingsRouteFromPath", () => {
  it("reads the section from the address", () => {
    expect(settingsRouteFromPath("/settings/keys")).toBe("keys");
    expect(settingsRouteFromPath("/settings/appearance/")).toBe("appearance");
    expect(settingsRouteFromPath("/settings")).toBe("index");
  });

  it("is closed anywhere else, and for a section that doesn't exist", () => {
    expect(settingsRouteFromPath("/")).toBeNull();
    expect(settingsRouteFromPath("/c/abc")).toBeNull();
    expect(settingsRouteFromPath("/settings/nope")).toBeNull();
    expect(settingsRouteFromPath("/settingsx")).toBeNull();
    expect(settingsRouteFromPath("/settings/keys/extra")).toBeNull();
  });
});

describe("opening and closing", () => {
  it("opens over the page and goes back to it on close", () => {
    const history = fakeHistory("/c/123");
    openSettings(history, "/c/123", "memory");
    expect(history.url()).toBe("/settings/memory");
    selectSettingsSection(history, "keys");
    expect(history.url()).toBe("/settings/keys");
    closeSettings(history, "/");
    expect(history.url()).toBe("/c/123");
  });

  it("switches section instead of stacking when already open", () => {
    const history = fakeHistory("/library");
    openSettings(history, "/library");
    openSettings(history, "/settings", "shortcuts");
    expect(history.url()).toBe("/settings/shortcuts");
    closeSettings(history, "/");
    expect(history.url()).toBe("/library");
  });

  it("hands the router none of its own state when switching section", () => {
    const history = fakeHistory("/settings", { __NA: true });
    selectSettingsSection(history, "memory");
    expect(history.url()).toBe("/settings/memory");
    expect(history.state).toBeNull();
  });

  it("a hard load of the address closes onto the new chat", () => {
    const history = fakeHistory("/settings/keys");
    closeSettings(history, "/");
    expect(history.url()).toBe("/");
  });
});
