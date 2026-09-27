import { describe, expect, it } from "vitest";

import { isApplePlatform, isEditableTarget } from "./editable";
import {
  matchShortcut,
  shortcutIdSchema,
  shortcutKeys,
  shortcuts,
} from "./registry";

const press = (
  key: string,
  modifiers: Partial<Record<"altKey" | "ctrlKey" | "metaKey", boolean>> = {}
) => ({
  altKey: false,
  ctrlKey: false,
  key,
  metaKey: false,
  ...modifiers,
});

describe("the registry", () => {
  it("registers every id exactly once (ticket 024 keys off them)", () => {
    expect(shortcuts.map((shortcut) => shortcut.id).sort()).toEqual(
      [...shortcutIdSchema.options].sort()
    );
  });
});

describe("matchShortcut", () => {
  it("matches single keys case-insensitively and ignores Shift", () => {
    expect(matchShortcut(press("N"), false)?.id).toBe("chat.new");
    expect(matchShortcut(press("?"), false)?.id).toBe("help");
    expect(matchShortcut(press("["), true)?.id).toBe("branch.prev");
  });

  it("uses ⌘ on Apple platforms and Ctrl elsewhere", () => {
    expect(matchShortcut(press("b", { metaKey: true }), true)?.id).toBe(
      "sidebar.toggle"
    );
    expect(matchShortcut(press("b", { ctrlKey: true }), false)?.id).toBe(
      "sidebar.toggle"
    );
    expect(matchShortcut(press("b", { ctrlKey: true }), true)).toBeUndefined();
    expect(matchShortcut(press("k", { ctrlKey: true }), false)?.id).toBe(
      "palette.open"
    );
    expect(matchShortcut(press("k"), false)?.id).toBe("chat.prev");
  });

  it("ignores Alt chords", () => {
    expect(matchShortcut(press("n", { altKey: true }), false)).toBeUndefined();
  });
});

describe("shortcutKeys", () => {
  it("formats hints per platform", () => {
    expect(shortcutKeys({ key: "b", mod: true }, true)).toEqual(["⌘", "B"]);
    expect(shortcutKeys({ key: "b", mod: true }, false)).toEqual(["Ctrl", "B"]);
    expect(shortcutKeys({ key: "/", mod: false }, false)).toEqual(["/"]);
  });
});

describe("isEditableTarget", () => {
  it("is true for things you type into and widgets that own their keys", () => {
    const input = document.createElement("input");
    const checkbox = Object.assign(document.createElement("input"), {
      type: "checkbox",
    });
    const editor = document.createElement("div");
    editor.contentEditable = "true";
    document.body.append(editor);
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    const item = document.createElement("button");
    menu.append(item);

    expect(isEditableTarget(input)).toBe(true);
    expect(isEditableTarget(document.createElement("textarea"))).toBe(true);
    expect(isEditableTarget(editor)).toBe(true);
    expect(isEditableTarget(item)).toBe(true);
    expect(isEditableTarget(checkbox)).toBe(false);
    expect(isEditableTarget(document.createElement("button"))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
    editor.remove();
  });
});

describe("isApplePlatform", () => {
  it("reads the platform, then the user agent", () => {
    expect(isApplePlatform({ platform: "MacIntel" })).toBe(true);
    expect(isApplePlatform({ platform: "Win32" })).toBe(false);
    expect(
      isApplePlatform({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS)" })
    ).toBe(true);
  });
});
