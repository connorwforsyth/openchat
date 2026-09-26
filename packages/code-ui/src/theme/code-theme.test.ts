import { describe, expect, it } from "vitest";

import { codeThemeNames, createCodeTheme } from "./code-theme";

const TOKEN_EXPRESSION = /^(?:var\(--|color-mix\(in oklab, var\(--)/;

const colours = (value: unknown): string[] => {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap(colours);
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([key, inner]) =>
      key === "name" || key === "type" || key === "scope" || key === "fontStyle"
        ? []
        : colours(inner)
    );
  }
  return [];
};

describe("createCodeTheme", () => {
  it("names each scheme's theme", () => {
    expect(createCodeTheme("light")).toMatchObject({
      name: codeThemeNames.light,
      type: "light",
    });
    expect(createCodeTheme("dark")).toMatchObject({
      name: codeThemeNames.dark,
      type: "dark",
    });
  });

  it("draws every colour from a ui token", () => {
    const values = colours(createCodeTheme("light"));
    expect(values.length).toBeGreaterThan(20);
    for (const value of values) {
      expect(value).toMatch(TOKEN_EXPRESSION);
    }
  });

  it("shares one palette across schemes, since the tokens flip themselves", () => {
    const { name: _l, type: _lt, ...light } = createCodeTheme("light");
    const { name: _d, type: _dt, ...dark } = createCodeTheme("dark");
    expect(dark).toEqual(light);
  });
});
