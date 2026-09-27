import { describe, expect, it } from "vitest";

import {
  comboKeycaps,
  formatCombo,
  isEditableTarget,
  keyComboSchema,
  matchesCombo,
  parseCombo,
  platformFromUserAgent,
  worksWhileTyping,
} from "./keys";

const press = (
  key: string,
  modifiers: Partial<
    Record<"altKey" | "ctrlKey" | "metaKey" | "shiftKey", boolean>
  > = {}
) => ({
  altKey: false,
  ctrlKey: false,
  key,
  metaKey: false,
  shiftKey: false,
  ...modifiers,
});

describe("parseCombo", () => {
  it("normalises modifier order and letter case", () => {
    expect(keyComboSchema.parse("shift+Mod+k".replace("shift", "Shift"))).toBe(
      "Mod+Shift+K"
    );
    expect(keyComboSchema.parse("esc")).toBe("Escape");
    expect(keyComboSchema.parse("Mod++")).toBe("Mod++");
  });

  it("says what's wrong with a bad combo", () => {
    expect(parseCombo("")).toEqual({ error: { type: "empty" }, ok: false });
    expect(parseCombo("Hyper+K")).toEqual({
      error: { modifier: "Hyper", type: "unknown_modifier" },
      ok: false,
    });
    expect(parseCombo("Mod+Shift")).toEqual({
      error: { type: "modifier_only" },
      ok: false,
    });
    expect(parseCombo("Mod+Mod+K").ok).toBe(false);
    expect(parseCombo("Mod+Banana").ok).toBe(false);
  });
});

describe("display", () => {
  it("draws ⌘ on macOS and Ctrl elsewhere", () => {
    expect(comboKeycaps("Mod+K", "mac")).toEqual(["⌘", "K"]);
    expect(comboKeycaps("Mod+K", "windows")).toEqual(["Ctrl", "K"]);
    expect(formatCombo("Mod+Shift+;", "mac")).toBe("⌘⇧;");
    expect(formatCombo("Mod+Shift+;", "linux")).toBe("Ctrl+Shift+;");
    expect(formatCombo("Escape", "mac")).toBe("Esc");
  });

  it("detects the platform from a user agent", () => {
    expect(
      platformFromUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36"
      )
    ).toBe("mac");
    expect(platformFromUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64)")).toBe(
      "windows"
    );
    expect(platformFromUserAgent("Mozilla/5.0 (X11; Linux x86_64)")).toBe(
      "linux"
    );
  });
});

describe("matchesCombo", () => {
  it("resolves Mod per platform", () => {
    expect(matchesCombo(press("k", { metaKey: true }), "Mod+K", "mac")).toBe(
      true
    );
    expect(matchesCombo(press("k", { ctrlKey: true }), "Mod+K", "mac")).toBe(
      false
    );
    expect(
      matchesCombo(press("k", { ctrlKey: true }), "Mod+K", "windows")
    ).toBe(true);
  });

  it("matches punctuation by the character typed, whatever Shift did", () => {
    expect(matchesCombo(press("?", { shiftKey: true }), "?", "mac")).toBe(true);
    expect(matchesCombo(press("[", {}), "[", "mac")).toBe(true);
  });

  it("keeps letters exact: Shift+N is not N", () => {
    expect(matchesCombo(press("N", { shiftKey: true }), "N", "mac")).toBe(
      false
    );
    expect(matchesCombo(press("n"), "N", "mac")).toBe(true);
  });
});

describe("worksWhileTyping", () => {
  it("lets single keys through to text fields", () => {
    expect(worksWhileTyping("N")).toBe(false);
    expect(worksWhileTyping("?")).toBe(false);
    expect(worksWhileTyping("Shift+N")).toBe(false);
    expect(worksWhileTyping("Mod+K")).toBe(true);
    expect(worksWhileTyping("Escape")).toBe(true);
  });
});

describe("isEditableTarget", () => {
  it("treats text inputs and contenteditable as editable", () => {
    const text = document.createElement("input");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    const editor = document.createElement("div");
    editor.contentEditable = "true";
    document.body.append(editor);
    expect(isEditableTarget(text)).toBe(true);
    expect(isEditableTarget(checkbox)).toBe(false);
    expect(isEditableTarget(document.createElement("textarea"))).toBe(true);
    expect(isEditableTarget(editor)).toBe(true);
    expect(isEditableTarget(document.createElement("button"))).toBe(false);
    editor.remove();
  });
});
