import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  type BrandImage,
  brandFile,
  brandImages,
  isBrandAssetName,
  logoModeOf,
  logoViews,
  madeOnce,
  PLACEHOLDER_MARK,
  tabIcon,
  tileMark,
} from "./brand";
import { parseConfig } from "./parse";
import { toPublicConfig } from "./public";

const svg = (body: string, attributes = ""): BrandImage => ({
  kind: "svg",
  text: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"${attributes}>${body}</svg>`,
});
const themed = svg('<circle r="4" fill="currentColor"/>');
const unpainted = svg('<path d="M0 0h8v8z"/>');
const coloured = svg('<circle r="4" fill="red"/>');
/** A currentColor glyph on a coloured badge: the glyph must stay visible. */
const glyphOnBadge = svg(
  '<rect width="8" height="8" fill="crimson"/><path d="M2 2h4v4z" fill="currentColor"/>'
);
const png: BrandImage = {
  data: new Uint8Array([137, 80, 78, 71]),
  kind: "raster",
  mime: "image/png",
};

const PNG_IMAGE = /<image href="data:image\/png;base64,iVBORw==" /;
const SVG_IMAGE = /<image href="data:image\/svg\+xml;base64,[^"]+"/;

const parseOk = (text: string) => {
  const result = parseConfig(text, {});
  if (!result.ok) {
    throw new Error(JSON.stringify(result.error));
  }
  return result.value;
};

describe("logoModeOf", () => {
  it("masks a logo whose paint is all currentColor, or that names no colour", () => {
    expect(logoModeOf(themed)).toBe("mask");
    expect(logoModeOf(unpainted)).toBe("mask");
    expect(
      logoModeOf(svg('<path d="M0 0h8v8z" style="fill: currentColor"/>'))
    ).toBe("mask");
    expect(
      logoModeOf(
        svg(
          '<linearGradient id="g"><stop stop-color="currentColor"/></linearGradient><rect width="8" height="8" fill="url(#g)"/>'
        )
      )
    ).toBe("mask");
  });

  it("draws anything with a colour of its own as it is", () => {
    expect(logoModeOf(coloured)).toBe("image");
    expect(logoModeOf(glyphOnBadge)).toBe("image");
    expect(logoModeOf(svg("<style>path { fill: navy }</style><path/>"))).toBe(
      "image"
    );
    expect(logoModeOf(svg('<stop stop-color="blue"/>'))).toBe("image");
    expect(
      logoModeOf(
        svg('<circle r="4" fill="currentColor"/>', ' style="color:red"')
      )
    ).toBe("image");
    expect(logoModeOf(png)).toBe("image");
  });
});

describe("brandImages and logoViews", () => {
  it("falls back to a built-in mark and no logo when brand names neither", () => {
    const images = brandImages({ favicon: null, logo: null, logoDark: null });
    expect(images.icon).toEqual({ kind: "svg", text: PLACEHOLDER_MARK });
    expect(logoViews(images.logo)).toBeNull();
  });

  it("draws one currentColor logo once, as a mask for both themes", () => {
    const images = brandImages({ favicon: null, logo: themed, logoDark: null });
    expect(images.icon).toBe(themed);
    expect(logoViews(images.logo)).toEqual({
      dark: null,
      light: { mode: "mask", src: "/brand/logo" },
    });
  });

  it("draws a multi-colour logo as it is, and its dark variant on dark themes", () => {
    const images = brandImages({
      favicon: png,
      logo: glyphOnBadge,
      logoDark: coloured,
    });
    expect(images.icon).toBe(png);
    expect(logoViews(images.logo)).toEqual({
      dark: { mode: "image", src: "/brand/logo-dark" },
      light: { mode: "image", src: "/brand/logo" },
    });
  });

  it("serves each logo file untouched, so a glyph over a badge keeps both", () => {
    expect(brandFile(glyphOnBadge)).toEqual({
      body: glyphOnBadge.kind === "svg" ? glyphOnBadge.text : "",
      type: "image/svg+xml",
    });
    expect(brandFile(png)).toEqual({
      body: png.kind === "raster" ? png.data : null,
      type: "image/png",
    });
  });
});

describe("icons", () => {
  it("wraps the mark in a tab icon, turning a one-colour mark white on dark", () => {
    const mono = tabIcon(themed);
    expect(mono).toMatch(SVG_IMAGE);
    expect(mono).toContain(
      "@media (prefers-color-scheme:dark){image{filter:invert(1)}}"
    );
    expect(tabIcon(glyphOnBadge)).not.toContain("prefers-color-scheme");
    expect(tabIcon(png)).toMatch(PNG_IMAGE);
  });

  it("inverts only one-colour marks on tiles", () => {
    expect(tileMark(themed).invert).toBe(true);
    expect(tileMark(glyphOnBadge).invert).toBe(false);
  });
});

describe("madeOnce", () => {
  it("keeps what it made", async () => {
    let calls = 0;
    const get = madeOnce(
      (name: string) => {
        calls += 1;
        return Promise.resolve(`${name} ${calls}`);
      },
      () => Promise.resolve("fallback")
    );
    expect(await get("a")).toBe("a 1");
    expect(await get("a")).toBe("a 1");
    expect(calls).toBe(1);
  });

  it("answers a failure with the fallback, and tries again next time", async () => {
    let calls = 0;
    const get = madeOnce(
      (name: string) => {
        calls += 1;
        return calls === 1
          ? Promise.reject(new Error("missing viewBox"))
          : Promise.resolve(name);
      },
      (name, error) => Promise.resolve(`${name}: ${(error as Error).message}`)
    );
    expect(await get("tile")).toBe("tile: missing viewBox");
    expect(await get("tile")).toBe("tile");
    expect(calls).toBe(2);
  });
});

describe("assets", () => {
  it("serves every path the app and public config link to", () => {
    const views = logoViews({ dark: coloured, light: themed });
    const links = [
      views?.light.src,
      views?.dark?.src,
      toPublicConfig(parseOk("brand: { logo: ./mark.svg }")).brand.logoUrl,
      toPublicConfig(parseOk("")).brand.faviconUrl,
    ];
    for (const link of links) {
      expect(link?.startsWith("/brand/")).toBe(true);
      expect(isBrandAssetName(link?.slice("/brand/".length) ?? "")).toBe(true);
    }
  });

  it("has no logo URL without a logo, and no asset for object keys", () => {
    expect(toPublicConfig(parseOk("")).brand.logoUrl).toBeNull();
    expect(isBrandAssetName("constructor")).toBe(false);
  });

  it("ships the placeholder as brand/logo.svg", () => {
    const file = new URL("../../../brand/logo.svg", import.meta.url);
    expect(readFileSync(file, "utf8")).toBe(PLACEHOLDER_MARK);
    expect(logoModeOf({ kind: "svg", text: PLACEHOLDER_MARK })).toBe("mask");
  });
});
