import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  type BrandImage,
  brandAssetOf,
  brandImages,
  logoLayer,
  logoLayers,
  PLACEHOLDER_MARK,
  tabIcon,
  tileMark,
} from "./brand";
import { parseConfig } from "./parse";
import { toPublicConfig } from "./public";

const svg = (text: string): BrandImage => ({ kind: "svg", text });
const themed = svg(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><circle r="4" fill="currentColor"/></svg>'
);
const coloured = svg(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><circle r="4" fill="red"/></svg>'
);
const png: BrandImage = {
  data: new Uint8Array([137, 80, 78, 71]),
  kind: "raster",
  mime: "image/png",
};

const bodyOf = (file: ReturnType<typeof logoLayer>): string =>
  typeof file.body === "string" ? file.body : "";
const STYLE_ELEMENT = /<style>.*?<\/style>/g;
const DRAWN_ELEMENT = /<(?!svg\b|style\b|\/)[a-z]/i;
const CLEAR_PAINT = /^<svg[^>]*><style>svg\{color:transparent\}<\/style>/;
const WRAPPED_PNG =
  /^<svg [^>]*><image href="data:image\/png;base64,iVBORw==" /;

/** Whether an SVG draws anything: an element besides the root and styles. */
const draws = (text: string): boolean =>
  DRAWN_ELEMENT.test(text.replace(STYLE_ELEMENT, ""));

describe("brandImages", () => {
  it("falls back to a built-in mark and no logo when brand names neither", () => {
    const images = brandImages({ favicon: null, logo: null, logoDark: null });
    expect(images.icon).toEqual(svg(PLACEHOLDER_MARK));
    expect(images.logo).toBeNull();
  });

  it("uses one logo for both themes and the icon", () => {
    const images = brandImages({ favicon: null, logo: themed, logoDark: null });
    expect(images.icon).toBe(themed);
    expect(images.logo).toEqual({ dark: themed, light: themed });
  });

  it("prefers the favicon for icons and the dark logo on dark themes", () => {
    const images = brandImages({
      favicon: png,
      logo: themed,
      logoDark: coloured,
    });
    expect(images.icon).toBe(png);
    expect(images.logo).toEqual({ dark: coloured, light: themed });
  });
});

describe("logoLayer", () => {
  it("splits a currentColor logo: its shape inks, its paint goes clear", () => {
    expect(logoLayer(themed, "ink")).toEqual({
      body: themed.kind === "svg" ? themed.text : "",
      type: "image/svg+xml",
    });
    const paint = bodyOf(logoLayer(themed, "paint"));
    expect(paint).toMatch(CLEAR_PAINT);
    expect(paint).toContain('fill="currentColor"');
  });

  it("paints a logo with its own colours as it is, with nothing to ink", () => {
    expect(logoLayer(coloured, "paint")).toEqual({
      body: coloured.kind === "svg" ? coloured.text : "",
      type: "image/svg+xml",
    });
    const ink = logoLayer(coloured, "ink");
    expect(ink.type).toBe("image/svg+xml");
    expect(draws(bodyOf(ink))).toBe(false);
  });

  it("serves a raster logo's bytes as its paint", () => {
    expect(logoLayer(png, "paint")).toEqual({
      body: png.kind === "raster" ? png.data : null,
      type: "image/png",
    });
    expect(draws(bodyOf(logoLayer(png, "ink")))).toBe(false);
  });
});

describe("tabIcon", () => {
  it("switches a currentColor mark with the OS colour scheme", () => {
    const icon = tabIcon(themed);
    expect(icon).toContain("svg{color:black}");
    expect(icon).toContain(
      "@media (prefers-color-scheme:dark){svg{color:white}}"
    );
  });

  it("leaves a coloured mark alone and wraps a raster in an SVG", () => {
    expect(tabIcon(coloured)).toBe(coloured.kind === "svg" && coloured.text);
    expect(tabIcon(png)).toMatch(WRAPPED_PNG);
  });
});

describe("tileMark", () => {
  it("whitens a currentColor mark for the tile", () => {
    const text = Buffer.from(
      tileMark(themed).replace("data:image/svg+xml;base64,", ""),
      "base64"
    ).toString();
    expect(text).toContain("<style>svg{color:white}</style>");
  });
});

describe("assets", () => {
  it("serves every path the client and public config link to", () => {
    const links = [
      ...Object.values(logoLayers).flatMap(({ ink, paint }) => [ink, paint]),
      toPublicConfig(parseOk("brand: { logo: ./mark.svg }")).brand.logoUrl,
      toPublicConfig(parseOk("")).brand.faviconUrl,
    ];
    for (const link of links) {
      expect(link?.startsWith("/brand/")).toBe(true);
      expect(brandAssetOf(link?.slice("/brand/".length) ?? "")).toBeDefined();
    }
  });

  it("has no logo URL without a logo, and no asset for object keys", () => {
    expect(toPublicConfig(parseOk("")).brand.logoUrl).toBeNull();
    expect(brandAssetOf("constructor")).toBeUndefined();
  });

  it("ships the placeholder as brand/logo.svg", () => {
    const file = new URL("../../../brand/logo.svg", import.meta.url);
    expect(readFileSync(file, "utf8")).toBe(PLACEHOLDER_MARK);
  });
});

function parseOk(text: string) {
  const result = parseConfig(text, {});
  if (!result.ok) {
    throw new Error(JSON.stringify(result.error));
  }
  return result.value;
}
