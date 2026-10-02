import { describe, expect, it } from "vitest";

import {
  materialFile,
  materialPackage,
  materialSymbols,
  materialVariants,
  pickGlyphs,
  renderMaterialGlyphs,
  renderVendoredWeight,
  svgPathData,
  variantKey,
  vendoredWeightSchema,
  vendorWeight,
} from "./material";

describe("materialSymbols", () => {
  it("lists each glyph reference once, sorted", () => {
    const source = [
      "export const SearchIcon: Icon = (p) => draw(p, glyph.search);",
      "export const Trash2Icon: Icon = (p) => draw(p, glyph.delete);",
      "export const AgentIcon: Icon = (p) => draw(p, glyph.smart_toy);",
      "export const BotIcon: Icon = (p) => draw(p, glyph.smart_toy);",
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

describe("materialVariants", () => {
  it("is every style, weight and fill the config accepts", () => {
    expect(materialVariants).toHaveLength(3 * 7 * 2);
    expect(materialVariants).toContainEqual({
      fill: true,
      style: "sharp",
      weight: 700,
    });
  });
});

describe("vendorWeight", () => {
  const svg = (d: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960"><path d="${d}"/></svg>`;

  it("keys each style and fill's paths by symbol", () => {
    const vendored = vendorWeight(
      { version: "1.2.3", weight: 300 },
      ["add"],
      (file) => svg(file)
    );
    expect(vendored.ok && vendored.value.package).toBe(
      "@material-symbols/svg-300"
    );
    expect(vendored.ok && vendored.value.variants).toEqual({
      outlined: { add: "outlined/add.svg" },
      "outlined-fill": { add: "outlined/add-fill.svg" },
      rounded: { add: "rounded/add.svg" },
      "rounded-fill": { add: "rounded/add-fill.svg" },
      sharp: { add: "sharp/add.svg" },
      "sharp-fill": { add: "sharp/add-fill.svg" },
    });
  });

  it("fails with every missing or unusable file", () => {
    const vendored = vendorWeight(
      { version: "1.2.3", weight: 300 },
      ["add", "gone"],
      (file) => {
        if (file.startsWith("sharp/gone")) {
          return;
        }
        return file === "rounded/add.svg" ? "<svg/>" : svg("M1Z");
      }
    );
    expect(vendored.ok ? [] : vendored.error).toEqual([
      "@material-symbols/svg-300/rounded/add.svg: not a single path in a 0 -960 960 960 box",
      "@material-symbols/svg-300/sharp/gone.svg: missing",
      "@material-symbols/svg-300/sharp/gone-fill.svg: missing",
    ]);
  });
});

describe("pickGlyphs", () => {
  const data = vendoredWeightSchema.parse({
    package: "@material-symbols/svg-400",
    variants: { "rounded-fill": { add: "M1Z", search: "M2Z" } },
    version: "1.2.3",
  });

  it("picks the variant's path for each symbol, in order", () => {
    expect(variantKey({ fill: true, style: "rounded" })).toBe("rounded-fill");
    expect(
      pickGlyphs(data, { fill: true, style: "rounded", weight: 400 }, [
        "search",
        "add",
      ])
    ).toEqual({
      ok: true,
      value: [
        ["search", "M2Z"],
        ["add", "M1Z"],
      ],
    });
  });

  it("names symbols that were mapped after the last icons:vendor", () => {
    const picked = pickGlyphs(
      data,
      { fill: false, style: "rounded", weight: 400 },
      ["add"]
    );
    expect(picked.ok ? [] : picked.error).toEqual([
      'material: "add" isn\'t vendored for rounded in svg-400.json; run `bun run icons:vendor` in packages/icons',
    ]);
  });
});

describe("renderVendoredWeight", () => {
  it("sorts variants and symbols so regenerating diffs cleanly", () => {
    const source = renderVendoredWeight({
      package: "@material-symbols/svg-400",
      variants: { outlined: { c: "M3Z" }, sharp: { a: "M1Z", b: "M2Z" } },
      version: "1.2.3",
    });
    expect(source.indexOf('"outlined"')).toBeLessThan(
      source.indexOf('"sharp"')
    );
    expect(source.indexOf('"a"')).toBeLessThan(source.indexOf('"b"'));
    expect(source.endsWith("}\n")).toBe(true);
  });
});

describe("renderMaterialGlyphs", () => {
  const source = renderMaterialGlyphs(
    { fill: true, style: "rounded", weight: 500 },
    { package: "@material-symbols/svg-500", version: "0.47.5" },
    [
      ["add", "M1Z"],
      ["delete", "M2Z"],
    ]
  );

  it("exports one string per symbol, naming the variant", () => {
    expect(source).toContain(
      "vendor/material-symbols/svg-500.json\n// (@material-symbols/svg-500 0.47.5): rounded, filled."
    );
    expect(source).toContain('export const add = "M1Z";');
  });

  it("exports reserved words under their own name", () => {
    expect(source).toContain(
      'const delete_ = "M2Z";\nexport { delete_ as delete };'
    );
  });
});
