import { describe, expect, it } from "vitest";

import { menuKeyAction, moveActive, slashStage } from "./triggers";

describe("menuKeyAction", () => {
  it("maps the menu keys", () => {
    expect(menuKeyAction({ key: "ArrowDown", shiftKey: false })).toBe("next");
    expect(menuKeyAction({ key: "ArrowUp", shiftKey: false })).toBe("previous");
    expect(menuKeyAction({ key: "Enter", shiftKey: false })).toBe("choose");
    expect(menuKeyAction({ key: "Tab", shiftKey: false })).toBe("choose");
    expect(menuKeyAction({ key: "Escape", shiftKey: false })).toBe("dismiss");
  });

  it("leaves Shift+Enter, Shift+Tab and typing alone", () => {
    expect(menuKeyAction({ key: "Enter", shiftKey: true })).toBeUndefined();
    expect(menuKeyAction({ key: "Tab", shiftKey: true })).toBeUndefined();
    expect(menuKeyAction({ key: "a", shiftKey: false })).toBeUndefined();
  });
});

describe("moveActive", () => {
  it("wraps at both ends", () => {
    expect(moveActive(2, 3, "next")).toBe(0);
    expect(moveActive(0, 3, "previous")).toBe(2);
    expect(moveActive(1, 3, "next")).toBe(2);
  });

  it("stays at 0 for an empty list", () => {
    expect(moveActive(0, 0, "next")).toBe(0);
  });
});

describe("slashStage", () => {
  it("lists commands until /open: asks for a file", () => {
    expect(slashStage("op")).toEqual({ query: "op", stage: "commands" });
    expect(slashStage("open")).toEqual({ query: "open", stage: "commands" });
    expect(slashStage("open:")).toEqual({ query: "", stage: "open" });
    expect(slashStage("open:app")).toEqual({ query: "app", stage: "open" });
  });
});
