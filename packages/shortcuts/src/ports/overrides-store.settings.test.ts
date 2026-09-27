import { describe, expect, it } from "vitest";

import type { ShortcutOverrides } from "../overrides";
import { createMemoryOverridesStore } from "./overrides-store.memory";
import {
  createSettingsOverridesStore,
  type ShortcutSettingsApi,
} from "./overrides-store.settings";

/** A fake `me.settings` / `me.updateSettings` pair; `down` makes both reject. */
const fakeSettings = (initial: unknown = {}) => {
  let stored = initial;
  const state: { down: boolean; saves: ShortcutOverrides[] } = {
    down: false,
    saves: [],
  };
  const api: ShortcutSettingsApi = {
    load: () =>
      state.down
        ? Promise.reject(new Error("offline"))
        : Promise.resolve(stored),
    save: (overrides) => {
      if (state.down) {
        return Promise.reject(new Error("offline"));
      }
      stored = overrides;
      state.saves.push(overrides);
      return Promise.resolve(stored);
    },
  };
  return { api, state };
};

describe("createSettingsOverridesStore", () => {
  it("loads and saves through user settings, dropping entries it doesn't know", async () => {
    const { api, state } = fakeSettings({
      "chat.new": ["Mod+Shift+O"],
      "not.a.shortcut": ["Mod+Q"],
    });
    const local = createMemoryOverridesStore();
    const store = createSettingsOverridesStore(api, local);
    expect(await store.load()).toEqual({
      ok: true,
      value: { "chat.new": ["Mod+Shift+O"] },
    });
    const next = { "palette.open": ["Mod+P"] };
    expect(await store.save(next)).toEqual({ ok: true, value: next });
    expect(state.saves).toEqual([next]);
    // Nothing pending, so nothing kept locally.
    expect(await local.load()).toEqual({ ok: true, value: {} });
  });

  it("moves overrides recorded in this browser up to the server once", async () => {
    const { api, state } = fakeSettings({});
    const legacy = { help: ["F1"] };
    const local = createMemoryOverridesStore(legacy);
    const store = createSettingsOverridesStore(api, local);
    expect(await store.load()).toEqual({ ok: true, value: legacy });
    expect(state.saves).toEqual([legacy]);
    expect(await local.load()).toEqual({ ok: true, value: {} });
    // A reset on another device isn't undone by a stale local copy.
    state.saves.length = 0;
    await api.save({});
    expect(await store.load()).toEqual({ ok: true, value: {} });
  });

  it("keeps a save on the device while the server is away, and sends it later", async () => {
    const { api, state } = fakeSettings({ "chat.new": ["Mod+J"] });
    const local = createMemoryOverridesStore();
    const store = createSettingsOverridesStore(api, local);
    state.down = true;
    const offline = { "chat.new": ["Mod+Shift+J"] };
    expect(await store.save(offline)).toEqual({ ok: true, value: offline });
    expect(await store.load()).toEqual({ ok: true, value: offline });

    state.down = false;
    expect(await store.load()).toEqual({ ok: true, value: offline });
    expect(state.saves).toEqual([offline]);
    expect(await local.load()).toEqual({ ok: true, value: {} });
  });

  it("falls back to defaults when the server is away and nothing is pending", async () => {
    const { api, state } = fakeSettings({ "chat.new": ["Mod+J"] });
    state.down = true;
    const store = createSettingsOverridesStore(
      api,
      createMemoryOverridesStore()
    );
    expect(await store.load()).toEqual({ ok: true, value: {} });
  });
});
