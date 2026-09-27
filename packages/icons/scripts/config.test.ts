import { describe, expect, it } from "vitest";

import { describeChoice, resolveIconChoice } from "./config";

const lucide = {
  fill: false,
  set: "lucide",
  style: "outlined",
  weight: 400,
} as const;

describe("resolveIconChoice", () => {
  it("defaults to lucide with Material's defaults filled in", () => {
    expect(resolveIconChoice(undefined, {})).toEqual({
      ok: true,
      value: lucide,
    });
  });

  it("reads the config's icons block", () => {
    expect(
      resolveIconChoice(
        { fill: true, set: "material", style: "rounded", weight: 300 },
        {}
      )
    ).toEqual({
      ok: true,
      value: { fill: true, set: "material", style: "rounded", weight: 300 },
    });
  });

  it("lets ICON_* override the config, case-insensitively", () => {
    expect(
      resolveIconChoice(
        { set: "material", style: "rounded" },
        {
          ICON_FILL: "1",
          ICON_SET: " Phosphor ",
          ICON_STYLE: "SHARP",
          ICON_WEIGHT: "700",
        }
      )
    ).toEqual({
      ok: true,
      value: { fill: true, set: "phosphor", style: "sharp", weight: 700 },
    });
  });

  it("ignores blank variables, like an unset Docker build arg", () => {
    expect(
      resolveIconChoice({ set: "material" }, { ICON_SET: "", ICON_WEIGHT: " " })
    ).toEqual({ ok: true, value: { ...lucide, set: "material" } });
  });

  it("interpolates env references like the rest of the config", () => {
    // Built with "$" + "{" so the source doesn't read as a broken template.
    const reference = (body: string) => `${"$"}{${body}}`;
    expect(
      resolveIconChoice(
        { set: reference("ICONS:-material"), style: reference("ICON_VARIANT") },
        {}
      )
    ).toEqual({ ok: true, value: { ...lucide, set: "material" } });
  });

  it("names the variable or the config key that's wrong", () => {
    const result = resolveIconChoice(
      { extra: 1, set: "fontawesome" },
      { ICON_WEIGHT: "450" }
    );
    expect(result.ok).toBe(false);
    const problems = result.ok ? [] : result.error;
    expect(problems).toHaveLength(3);
    expect(problems.some((line) => line.startsWith("icons.set:"))).toBe(true);
    expect(problems.some((line) => line.startsWith("ICON_WEIGHT:"))).toBe(true);
    expect(problems.some((line) => line.includes('"extra"'))).toBe(true);
  });

  it("rejects an icons block that isn't a mapping", () => {
    expect(resolveIconChoice("material", {})).toEqual({
      error: ["icons: must be a mapping"],
      ok: false,
    });
  });
});

describe("describeChoice", () => {
  it("spells out Material's variant and nothing else's", () => {
    expect(describeChoice(lucide)).toBe("lucide");
    expect(
      describeChoice({
        fill: true,
        set: "material",
        style: "sharp",
        weight: 200,
      })
    ).toBe("material (sharp, 200, filled)");
  });
});
