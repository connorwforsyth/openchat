import { describe, expect, it } from "vitest";

import {
  describeChoice,
  iconEnvSet,
  iconEnvWarning,
  resolveIconChoice,
} from "./config";

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

  it("lets ICON_* decide, case-insensitively, when there's no icons block", () => {
    expect(
      resolveIconChoice(undefined, {
        ICON_FILL: "1",
        ICON_SET: " Material ",
        ICON_STYLE: "SHARP",
        ICON_WEIGHT: "700",
      })
    ).toEqual({
      ok: true,
      value: { fill: true, set: "material", style: "sharp", weight: 700 },
    });
  });

  it("ignores ICON_* when the config has an icons block (130)", () => {
    // Connor's case: Phosphor in the yaml, a leftover ICON_SET in .env.
    expect(
      resolveIconChoice({ set: "phosphor" }, { ICON_SET: "material" })
    ).toEqual({ ok: true, value: { ...lucide, set: "phosphor" } });
    // An empty block (`icons:`) is still a block: the defaults, not the env.
    expect(resolveIconChoice(null, { ICON_SET: "material" })).toEqual({
      ok: true,
      value: lucide,
    });
  });

  it("ignores blank variables, like an unset Docker build arg", () => {
    expect(
      resolveIconChoice(undefined, { ICON_SET: "", ICON_WEIGHT: " " })
    ).toEqual({ ok: true, value: lucide });
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

  it("names the config key that's wrong", () => {
    const result = resolveIconChoice({ extra: 1, set: "fontawesome" }, {});
    expect(result.ok).toBe(false);
    const problems = result.ok ? [] : result.error;
    expect(problems).toHaveLength(2);
    expect(problems.some((line) => line.startsWith("icons.set:"))).toBe(true);
    expect(problems.some((line) => line.includes('"extra"'))).toBe(true);
  });

  it("names the variable that's wrong when it's the one deciding", () => {
    const result = resolveIconChoice(undefined, { ICON_WEIGHT: "450" });
    expect(result.ok).toBe(false);
    const problems = result.ok ? [] : result.error;
    expect(problems).toHaveLength(1);
    expect(problems[0]?.startsWith("ICON_WEIGHT:")).toBe(true);
  });

  it("rejects an icons block that isn't a mapping", () => {
    expect(resolveIconChoice("material", {})).toEqual({
      error: ["icons: must be a mapping"],
      ok: false,
    });
  });
});

describe("iconEnvWarning", () => {
  const source = "apps/web/app.config.yaml";

  it("says nothing when no ICON_* variable has a value", () => {
    expect(iconEnvWarning({ set: "phosphor" }, {}, source)).toBeUndefined();
    expect(
      iconEnvWarning(undefined, { ICON_SET: "", ICON_STYLE: " " }, undefined)
    ).toBeUndefined();
  });

  it("names the variables a block makes it ignore, on one line", () => {
    const warning = iconEnvWarning(
      { set: "phosphor" },
      { ICON_SET: "material", ICON_STYLE: "rounded" },
      source
    );
    expect(warning).toContain("ICON_SET, ICON_STYLE are set but ignored");
    expect(warning).toContain(`the icons block in ${source} decides`);
    expect(warning).not.toContain("\n");
  });

  it("names the variable that decides when there's no block", () => {
    expect(
      iconEnvWarning(undefined, { ICON_SET: "material" }, source)
    ).toContain(`ICON_SET sets the icons because ${source} has no icons block`);
    expect(
      iconEnvWarning(undefined, { ICON_SET: "material" }, undefined)
    ).toContain("because there's no app.config.yaml");
  });

  it("never repeats a value", () => {
    const warning = iconEnvWarning(
      { set: "lucide" },
      { ICON_SET: "some-unusual-value" },
      source
    );
    expect(warning).not.toContain("some-unusual-value");
  });
});

describe("iconEnvSet", () => {
  it("lists the variables with a value, in a fixed order", () => {
    expect(
      iconEnvSet({ ICON_FILL: "0", ICON_SET: "material", ICON_STYLE: "" })
    ).toEqual(["ICON_FILL", "ICON_SET"]);
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
