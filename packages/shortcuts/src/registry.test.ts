import { describe, expect, it } from "vitest";

import { comboToAccelerator, electronAccelerator } from "./electron";
import { findConflicts, resolveBindings } from "./overrides";
import { getShortcut, shortcutIdSchema, shortcutRegistry } from "./registry";

describe("shortcutRegistry", () => {
  it("defines every id exactly once", () => {
    expect(shortcutRegistry.map((each) => each.id)).toEqual(
      shortcutIdSchema.options
    );
  });

  it("carries the ids and keys the app shell binds (009)", () => {
    const keys = (id: Parameters<typeof getShortcut>[0]) =>
      getShortcut(id).keys;
    expect(keys("chat.new")).toEqual(["N", "Mod+Shift+O"]);
    expect(keys("composer.focus")).toEqual(["/"]);
    expect(keys("chat.next")).toEqual(["J"]);
    expect(keys("chat.prev")).toEqual(["K"]);
    expect(keys("branch.prev")).toEqual(["["]);
    expect(keys("branch.next")).toEqual(["]"]);
    expect(keys("panel.sandbox")).toEqual(["S"]);
    expect(keys("panel.artifacts")).toEqual(["A"]);
    expect(keys("help")).toEqual(["?", "Mod+/"]);
    expect(keys("sidebar.toggle")).toEqual(["Mod+B", "Mod+Shift+S"]);
    expect(keys("palette.open")).toEqual(["Mod+K"]);
    expect(keys("dot.open")).toEqual(["Mod+.", "Mod+Shift+D"]);
  });

  it("has no clashing defaults", () => {
    expect(findConflicts(resolveBindings({}))).toEqual([]);
  });
});

describe("electronAccelerator", () => {
  it("maps Mod to CommandOrControl", () => {
    expect(electronAccelerator("palette.open")).toBe("CommandOrControl+K");
    expect(electronAccelerator("reply.copy")).toBe("CommandOrControl+Shift+;");
    expect(comboToAccelerator("Mod+Alt+ArrowUp")).toBe(
      "CommandOrControl+Alt+Up"
    );
    expect(comboToAccelerator("Mod++")).toBe("CommandOrControl+Plus");
    expect(comboToAccelerator("F5")).toBe("F5");
  });

  it("leaves single keys and Escape to the renderer", () => {
    expect(electronAccelerator("chat.new")).toBeNull();
    expect(electronAccelerator("help")).toBeNull();
    expect(electronAccelerator("run.stop")).toBeNull();
    expect(comboToAccelerator("Shift+N")).toBeNull();
  });

  it("follows the user's overrides", () => {
    const bindings = resolveBindings({ "palette.open": ["Mod+P"] });
    expect(electronAccelerator("palette.open", bindings)).toBe(
      "CommandOrControl+P"
    );
    expect(
      electronAccelerator(
        "palette.open",
        resolveBindings({ "palette.open": [] })
      )
    ).toBeNull();
  });
});
