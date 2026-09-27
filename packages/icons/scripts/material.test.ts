import { describe, expect, it } from "vitest";

import {
  materialFile,
  materialPackage,
  materialSymbols,
  renderMaterialGlyphs,
  svgPathData,
} from "./material";

describe("materialSymbols", () => {
  it("lists each glyph reference once, sorted", () => {
    const source = [
      "export const SearchIcon = fromMaterial(glyph.search);",
      "export const Trash2Icon = fromMaterial(glyph.delete);",
      "export const AgentIcon = fromMaterial(glyph.smart_toy);",
      "export const BotIcon = fromMaterial(glyph.smart_toy);",
    ].join("\n");
    expect(materialSymbols(source)).toEqual(["delete", "search", "smart_toy"]);
  });
});

describe("materialFile", () => {
  it("picks the weight's package and the style and fill's file", () => {
    expect(materialPackage(300)).toBe("@material-symbols/svg-300");
    expect(materialFile({ fill: false, style: "outlined" }, "search")).toBe(
      "outlined/search.svg"
    );
    expect(materialFile({ fill: true, style: "rounded" }, "search")).toBe(
      "rounded/search-fill.svg"
    );
  });
});

describe("svgPathData", () => {
  const svg = (body: string, viewBox = "0 -960 960 960") =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="${viewBox}">${body}</svg>`;

  it("returns the one path's data", () => {
    expect(svgPathData(svg('<path d="M1 2h3Z"/>'))).toBe("M1 2h3Z");
  });

  it("refuses shapes the adapter can't draw", () => {
    expect(svgPathData(svg('<path d="M1Z"/><path d="M2Z"/>'))).toBeUndefined();
    expect(svgPathData(svg('<path d="M1Z"/>', "0 0 24 24"))).toBeUndefined();
    expect(svgPathData(svg("<circle r='4'/>"))).toBeUndefined();
  });
});

describe("renderMaterialGlyphs", () => {
  const source = renderMaterialGlyphs(
    { fill: true, style: "rounded", weight: 500 },
    [
      ["add", "M1Z"],
      ["delete", "M2Z"],
    ]
  );

  it("exports one string per symbol, naming the variant", () => {
    expect(source).toContain("@material-symbols/svg-500, rounded,\n// filled.");
    expect(source).toContain('export const add = "M1Z";');
  });

  it("exports reserved words under their own name", () => {
    expect(source).toContain(
      'const delete_ = "M2Z";\nexport { delete_ as delete };'
    );
  });
});
