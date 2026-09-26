import { describe, expect, it } from "vitest";

import {
  exportedIconNames,
  findGaps,
  formatGapReport,
  parseIconSet,
  renderSelection,
  resolveSelection,
} from "./registry";

const names = ["CheckIcon", "SendIcon", "XIcon"];

describe("exportedIconNames", () => {
  it("lists `export const …Icon` declarations only", () => {
    const source = [
      'import { Check } from "lucide-react";',
      "export const CheckIcon: Icon = Check;",
      "export const SendIcon = fromPhosphor(PaperPlaneRight);",
      "const PrivateIcon = Check;",
      "export const helper = 1;",
    ].join("\n");
    expect(exportedIconNames(source)).toEqual(["CheckIcon", "SendIcon"]);
  });
});

describe("parseIconSet", () => {
  it("defaults to lucide when unset or blank", () => {
    expect(parseIconSet(undefined)).toEqual({ ok: true, value: "lucide" });
    expect(parseIconSet("  ")).toEqual({ ok: true, value: "lucide" });
  });

  it("accepts known sets case-insensitively", () => {
    expect(parseIconSet("Phosphor")).toEqual({ ok: true, value: "phosphor" });
  });

  it("returns an error for an unknown set", () => {
    const result = parseIconSet("fontawesome");
    expect(result.ok).toBe(false);
  });
});

describe("resolveSelection", () => {
  it("splits names into drawn-by-set and lucide fallback", () => {
    expect(resolveSelection(names, new Set(["SendIcon", "XIcon"]))).toEqual({
      fallback: ["CheckIcon"],
      fromSet: ["SendIcon", "XIcon"],
    });
  });
});

describe("renderSelection", () => {
  it("re-exports from the chosen set and falls back to lucide", () => {
    const source = renderSelection({
      platform: "web",
      selection: { fallback: ["CheckIcon"], fromSet: ["SendIcon", "XIcon"] },
      setFile: "./sets/phosphor",
      setId: "phosphor",
    });
    expect(source).toContain(
      'export { SendIcon, XIcon } from "./sets/phosphor";'
    );
    expect(source).toContain('export { CheckIcon } from "./sets/lucide";');
  });

  it("uses only lucide when lucide is chosen", () => {
    const source = renderSelection({
      platform: "native",
      selection: { fallback: [], fromSet: names },
      setFile: "./sets/lucide.native",
      setId: "lucide",
    });
    expect(source).toContain(
      'export { CheckIcon, SendIcon, XIcon } from "./sets/lucide.native";'
    );
    expect(source).not.toContain("Not in");
  });

  it("falls back entirely when the set has no file for the platform", () => {
    const source = renderSelection({
      platform: "native",
      selection: { fallback: names, fromSet: [] },
      setFile: undefined,
      setId: "material",
    });
    expect(source).toContain(
      'export { CheckIcon, SendIcon, XIcon } from "./sets/lucide.native";'
    );
    expect(source).not.toContain("material.native");
  });

  it("wraps long export lists one name per line", () => {
    const many = Array.from({ length: 12 }, (_, index) => `Glyph${index}Icon`);
    const source = renderSelection({
      platform: "web",
      selection: { fallback: [], fromSet: many },
      setFile: "./sets/lucide",
      setId: "lucide",
    });
    expect(source).toContain("export {\n  Glyph0Icon,\n");
  });
});

describe("gap report", () => {
  const report = findGaps(names, [
    { available: new Set(names), platform: "web", setId: "lucide" },
    { available: new Set(["SendIcon"]), platform: "web", setId: "phosphor" },
    { available: undefined, platform: "native", setId: "tabler" },
  ]);

  it("lists the names each set lacks", () => {
    expect(report).toEqual([
      { missing: [], platform: "web", setId: "lucide" },
      { missing: ["CheckIcon", "XIcon"], platform: "web", setId: "phosphor" },
      { missing: names, platform: "native", setId: "tabler" },
    ]);
  });

  it("prints one line per set and platform", () => {
    expect(formatGapReport(report, names.length)).toBe(
      [
        "lucide (web): complete (3/3)",
        "phosphor (web): 1/3, falls back to lucide for CheckIcon, XIcon",
        "tabler (native): not implemented, all 3 fall back to lucide",
      ].join("\n")
    );
  });
});
