import { describe, expect, it } from "vitest";

import {
  exportedIconNames,
  findGaps,
  formatGapReport,
  lucideBindings,
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

describe("lucideBindings", () => {
  it("maps each name to the lucide export that draws it", () => {
    const bindings = lucideBindings(
      [
        'import { Check, GitBranch } from "lucide-react-native";',
        "export const CheckIcon: NativeIcon = Check;",
        "export const BranchIcon: NativeIcon = GitBranch;",
      ].join("\n")
    );
    expect(bindings?.module).toBe("lucide-react-native");
    expect([...(bindings?.exports ?? [])]).toEqual([
      ["CheckIcon", "Check"],
      ["BranchIcon", "GitBranch"],
    ]);
  });

  it("returns nothing for a file that doesn't import lucide", () => {
    expect(lucideBindings("export const XIcon = 1;")).toBeUndefined();
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

  it("re-exports a set's gaps straight from lucide when it can", () => {
    const source = renderSelection({
      lucide: {
        exports: new Map([["CheckIcon", "Check"]]),
        module: "lucide-react",
      },
      platform: "web",
      selection: {
        fallback: ["CheckIcon", "XIcon"],
        fromSet: ["SendIcon"],
      },
      setFile: "./sets/material",
      setId: "material",
    });
    expect(source).toContain('export { SendIcon } from "./sets/material";');
    expect(source).toContain(
      'export { Check as CheckIcon } from "lucide-react";'
    );
    // A name the bindings miss still resolves, through the set file.
    expect(source).toContain('export { XIcon } from "./sets/lucide";');
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
