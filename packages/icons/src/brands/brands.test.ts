import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { readMarks } from "../../scripts/brands";
import { BrandMark, brandMark, brandName, hasBrandMark } from "./brand-mark";
import { brandMarkNames, brands } from "./brands";
import { parseMarkSvg } from "./codegen";
import { LOBE_ICONS_VERSION, marks } from "./marks.generated";

// `marks.generated.ts` is checked in, so it can go stale against the
// installed @lobehub/icons-static-svg or `brands.ts`. This is the check.

describe("marks.generated.ts", () => {
  it("matches the installed package (run `bun run icons:generate` in packages/icons if not)", async () => {
    const current = await readMarks();
    expect({ marks, version: LOBE_ICONS_VERSION }).toEqual(current);
  });

  it("has a mark for every one brands.ts names, and no others", () => {
    expect(Object.keys(marks).sort()).toEqual([...brandMarkNames()]);
  });

  it("covers the vendors the ticket lists", () => {
    for (const id of [
      "anthropic",
      "openai",
      "google",
      "meta",
      "mistral",
      "xai",
      "deepseek",
      "qwen",
      "alibaba",
      "cohere",
      "amazon",
      "microsoft",
      "perplexity",
      "moonshotai",
      "zhipu",
      "nvidia",
    ]) {
      expect(hasBrandMark(id), id).toBe(true);
    }
  });
});

describe("parseMarkSvg", () => {
  it("keeps paths and their rules, inheriting the root's fill rule", () => {
    const parsed = parseMarkSvg(
      '<svg fill="currentColor" fill-rule="evenodd" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><title>X</title><path d="M0 0h1"></path><path d="M1 1h1" fill-opacity=".5" fill-rule="nonzero"/></svg>'
    );
    expect(parsed).toEqual({
      mark: {
        paths: [
          { d: "M0 0h1", fillRule: "evenodd" },
          { d: "M1 1h1", fillOpacity: 0.5, fillRule: "nonzero" },
        ],
        title: "X",
        viewBox: "0 0 24 24",
      },
      ok: true,
    });
  });

  it("refuses a fixed colour, a gradient or a stroke rather than half-copying", () => {
    expect(
      parseMarkSvg('<svg viewBox="0 0 1 1"><path d="M0 0" fill="black"/></svg>')
        .ok
    ).toBe(false);
    expect(
      parseMarkSvg('<svg viewBox="0 0 1 1"><defs></defs><path d="M0 0"/></svg>')
        .ok
    ).toBe(false);
    expect(
      parseMarkSvg('<svg viewBox="0 0 1 1"><path d="M0 0" stroke="x"/></svg>')
        .ok
    ).toBe(false);
    expect(parseMarkSvg('<svg viewBox="0 0 1 1"></svg>').ok).toBe(false);
  });
});

describe("BrandMark", () => {
  it("draws a known vendor in currentColor, hidden from assistive tech", () => {
    const html = renderToStaticMarkup(
      createElement(BrandMark, { brand: "anthropic", className: "size-4" })
    );
    expect(html).toContain('fill="currentColor"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('class="size-4"');
    expect(html).toContain(brandMark("anthropic")?.paths[0]?.d);
  });

  it("draws nothing for an unknown vendor, so the caller's fallback shows", () => {
    expect(
      renderToStaticMarkup(createElement(BrandMark, { brand: "acme" }))
    ).toBe("");
    expect(hasBrandMark("acme")).toBe(false);
    // Not an own key, so never a prototype property.
    expect(hasBrandMark("constructor")).toBe(false);
  });

  it("names vendors, and unknown ids as written", () => {
    expect(brandName("openai")).toBe("OpenAI");
    expect(brandName("x-ai")).toBe("xAI");
    expect(brandName("acme")).toBe("acme");
    expect(Object.keys(brands).length).toBeGreaterThan(15);
  });
});
