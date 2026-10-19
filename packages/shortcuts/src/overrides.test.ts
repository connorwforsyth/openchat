import { describe, expect, it } from "vitest";

import {
  checkRecording,
  findConflicts,
  isOverridden,
  parseOverrides,
  resetOverride,
  resolveBindings,
  setOverride,
} from "./overrides";
import { createMemoryOverridesStore } from "./ports/overrides-store.memory";
import { createStorageOverridesStore } from "./ports/overrides-store.storage";

describe("resolveBindings", () => {
  it("layers overrides over defaults; an empty list switches one off", () => {
    const bindings = resolveBindings({
      "chat.new": [],
      "palette.open": ["Mod+P"],
    });
    expect(bindings.get("palette.open")).toEqual(["Mod+P"]);
    expect(bindings.get("chat.new")).toEqual([]);
    expect(bindings.get("help")).toEqual(["?", "Mod+/"]);
  });

  it("sets and resets without touching the input", () => {
    const start = { help: ["F1"] };
    const next = setOverride(start, "chat.new", ["Mod+Alt+N"]);
    expect(start).toEqual({ help: ["F1"] });
    expect(isOverridden(next, "chat.new")).toBe(true);
    expect(resetOverride(next, "chat.new")).toEqual({ help: ["F1"] });
  });
});

describe("checkRecording", () => {
  const defaults = resolveBindings({});

  it("normalises an accepted combo", () => {
    expect(checkRecording(defaults, "chat.new", "Alt+Shift+n")).toEqual({
      ok: true,
      value: "Alt+Shift+N",
    });
  });

  it("refuses combos another live shortcut uses", () => {
    expect(checkRecording(defaults, "chat.new", "Mod+K")).toEqual({
      error: { id: "palette.open", type: "conflict" },
      ok: false,
    });
  });

  it("refuses keys the browser keeps", () => {
    expect(checkRecording(defaults, "chat.new", "Mod+W")).toEqual({
      error: { type: "reserved" },
      ok: false,
    });
  });

  it("refuses nonsense", () => {
    expect(checkRecording(defaults, "chat.new", "Mod+")).toEqual({
      error: { type: "invalid" },
      ok: false,
    });
  });

  it("allows the same keys in scopes that never overlap", () => {
    // Nothing in the registry is palette-scoped yet, so model the rule directly.
    const bindings = resolveBindings({ "palette.open": ["Mod+J"] });
    expect(findConflicts(bindings)).toEqual([]);
  });
});

describe("parseOverrides", () => {
  it("drops unknown ids and bad combos instead of failing", () => {
    expect(
      parseOverrides({
        "chat.new": ["Mod+Banana"],
        help: ["F1"],
        "not.a.shortcut": ["N"],
      })
    ).toEqual({ help: ["F1"] });
    expect(parseOverrides("nope")).toEqual({});
  });
});

describe("OverridesStore adapters", () => {
  it("memory store round-trips", async () => {
    const store = createMemoryOverridesStore();
    await store.save({ help: ["F1"] });
    expect(await store.load()).toEqual({ ok: true, value: { help: ["F1"] } });
    expect(store.saves).toHaveLength(1);
  });

  it("storage store survives corrupt data and missing storage", async () => {
    const data = new Map<string, string>([["k", "{not json"]]);
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value);
      },
    };
    const store = createStorageOverridesStore(storage, "k");
    expect(await store.load()).toEqual({ ok: true, value: {} });
    await store.save({ "chat.new": ["Alt+N"] });
    expect(await store.load()).toEqual({
      ok: true,
      value: { "chat.new": ["Alt+N"] },
    });
    const none = createStorageOverridesStore(null, "k");
    expect(await none.load()).toEqual({ ok: true, value: {} });
    expect((await none.save({})).ok).toBe(false);
  });
});
