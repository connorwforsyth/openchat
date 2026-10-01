import { createI18n } from "@workspace/i18n/catalog";
import { describe, expect, it } from "vitest";

import {
  applyQuickShortcut,
  DEFAULT_QUICK_SHORTCUT,
  parseQuickShortcut,
  QUICK_SHORTCUT_PRESETS,
  registrationMessage,
  shortcutLabel,
} from "./quick-shortcut";

const i18n = createI18n("en");

describe("parseQuickShortcut", () => {
  it("defaults to ⌥Space", () => {
    expect(parseQuickShortcut(DEFAULT_QUICK_SHORTCUT)).toEqual({
      accelerator: "Alt+Space",
      combo: "Alt+Space",
      kind: "on",
    });
  });

  it.each([
    ["Mod+Shift+Space", "CommandOrControl+Shift+Space", "Mod+Shift+Space"],
    // Any order and case, as in the web app's settings.
    ["shift+mod+space", "CommandOrControl+Shift+Space", "Mod+Shift+Space"],
    // Electron's and macOS's names for the modifiers.
    ["Option+Space", "Alt+Space", "Alt+Space"],
    ["Cmd+Shift+K", "CommandOrControl+Shift+K", "Mod+Shift+K"],
    ["Ctrl+Alt+K", "Control+Alt+K", "Ctrl+Alt+K"],
    ["Meta+Space", "Super+Space", "Meta+Space"],
    // Function keys type nothing, so they may stand alone.
    ["F12", "F12", "F12"],
  ])("%s → %s", (setting, accelerator, combo) => {
    expect(parseQuickShortcut(setting)).toEqual({
      accelerator,
      combo,
      kind: "on",
    });
  });

  it("is off for null", () => {
    expect(parseQuickShortcut(null)).toEqual({ kind: "off" });
  });

  it.each([
    ["Hyper+Q", "invalid"],
    ["", "invalid"],
    ["Alt+", "invalid"],
    ["Mod+Mod+K", "invalid"],
    // These would swallow a key in every app.
    ["Q", "needs-modifier"],
    ["Shift+Space", "needs-modifier"],
    ["Space", "needs-modifier"],
  ])("refuses %s (%s)", (setting, error) => {
    expect(parseQuickShortcut(setting)).toEqual({
      combo: setting,
      error,
      kind: "invalid",
    });
  });

  it("offers presets that all register", () => {
    for (const preset of QUICK_SHORTCUT_PRESETS) {
      expect(parseQuickShortcut(preset)).toMatchObject({
        combo: preset,
        kind: "on",
      });
    }
  });
});

describe("shortcutLabel", () => {
  it("draws macOS symbols, and names elsewhere", () => {
    expect(shortcutLabel("Alt+Space", "mac")).toBe("⌥Space");
    expect(shortcutLabel("Mod+Shift+Space", "mac")).toBe("⌘⇧Space");
    expect(shortcutLabel("Alt+Space", "win")).toBe("Alt+Space");
    expect(shortcutLabel("Mod+Shift+Space", "linux")).toBe("Ctrl+Shift+Space");
  });
});

describe("registrationMessage", () => {
  const context = { i18n, platform: "mac" } as const;

  it("says nothing when it worked or there's no shortcut", () => {
    expect(registrationMessage({ kind: "registered" }, context)).toBeNull();
    expect(registrationMessage({ kind: "off" }, context)).toBeNull();
  });

  it("names a shortcut another app holds, and the way in without it", () => {
    const message = registrationMessage(
      { combo: "Alt+Space", kind: "taken" },
      context
    );
    expect(message?.message).toBe(
      "Another app is using ⌥Space, so it can't open Quick AI."
    );
    expect(message?.detail).toContain("menu bar");
  });

  it("quotes a setting that isn't a usable shortcut", () => {
    const message = registrationMessage(
      { kind: "invalid", shortcut: parseQuickShortcut("Hyper+Q") },
      context
    );
    expect(message?.message).toContain('"Hyper+Q"');
  });
});

describe("applyQuickShortcut", () => {
  const fakePort = (taken: readonly string[] = []) => {
    const held = new Set<string>();
    return {
      held,
      port: {
        register: (accelerator: string) => {
          if (taken.includes(accelerator)) {
            return false;
          }
          held.add(accelerator);
          return true;
        },
        unregister: (accelerator: string) => {
          held.delete(accelerator);
        },
      },
    };
  };
  const onPress = () => undefined;

  it("registers the shortcut", () => {
    const { held, port } = fakePort();
    expect(
      applyQuickShortcut({
        next: parseQuickShortcut("Alt+Space"),
        onPress,
        port,
        previous: null,
      })
    ).toEqual({ kind: "registered" });
    expect([...held]).toEqual(["Alt+Space"]);
  });

  it("releases the old shortcut before taking the new one", () => {
    const { held, port } = fakePort();
    port.register("Alt+Space");
    applyQuickShortcut({
      next: parseQuickShortcut("Mod+Shift+Space"),
      onPress,
      port,
      previous: parseQuickShortcut("Alt+Space"),
    });
    expect([...held]).toEqual(["CommandOrControl+Shift+Space"]);
  });

  it("reports a shortcut another app holds, and holds none", () => {
    const { held, port } = fakePort(["Alt+Space"]);
    expect(
      applyQuickShortcut({
        next: parseQuickShortcut("Alt+Space"),
        onPress,
        port,
        previous: null,
      })
    ).toEqual({ combo: "Alt+Space", kind: "taken" });
    expect(held.size).toBe(0);
  });

  it("turns the shortcut off, or refuses an unusable one", () => {
    const { held, port } = fakePort();
    port.register("Alt+Space");
    expect(
      applyQuickShortcut({
        next: parseQuickShortcut(null),
        onPress,
        port,
        previous: parseQuickShortcut("Alt+Space"),
      })
    ).toEqual({ kind: "off" });
    expect(held.size).toBe(0);
    expect(
      applyQuickShortcut({
        next: parseQuickShortcut("Q"),
        onPress,
        port,
        previous: null,
      })
    ).toMatchObject({ kind: "invalid" });
    expect(held.size).toBe(0);
  });

  it("counts an accelerator Electron rejects as unusable", () => {
    const port = {
      register: () => {
        throw new Error("Failed to parse accelerator");
      },
      unregister: () => undefined,
    };
    expect(
      applyQuickShortcut({
        next: parseQuickShortcut("Alt+Space"),
        onPress,
        port,
        previous: null,
      })
    ).toMatchObject({ kind: "invalid" });
  });
});
