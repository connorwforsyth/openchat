import { DESIGN_GUIDES } from "@workspace/artifacts-kit/kinds/site/design/generated";
import { SITE_TSX_MODULES } from "@workspace/artifacts-kit/kinds/site/tsx";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  pageComponent,
  SITE_RUNTIME_MODULES,
  type SitePageModule,
} from "./site-runtime";
import { compileSitePage } from "./site-tsx";

// The site runtime (163): a compiled page's imports resolve from its table,
// and its default export is the page. The design guide's examples are
// compiled as a save would be and rendered here, to static markup, which
// only ever happens to our own examples: model code is never rendered on
// the server.

const TSX_BLOCK = /```tsx\n([\s\S]*?)```/g;
const examples = [...DESIGN_GUIDES["site-ui"].matchAll(TSX_BLOCK)].map(
  (match) => match[1] ?? ""
);

/** What the page's shell does with the compiled code, without a browser. */
const asModule = (code: string): SitePageModule =>
  // Our examples, in a test: the shell passes the code as a function instead.
  new Function("require", "module", "exports", code) as SitePageModule;

const render = (source: string, path = "index.tsx") => {
  const page = pageComponent(asModule(compileSitePage(source, path)));
  return page.ok ? renderToStaticMarkup(createElement(page.value)) : page;
};

describe("the site runtime", () => {
  it("resolves exactly the modules a page may import", () => {
    expect(Object.keys(SITE_RUNTIME_MODULES).sort()).toEqual(
      [...SITE_TSX_MODULES].sort()
    );
  });

  it("refuses other imports, and wants a default export", () => {
    expect(render('import x from "lodash";\nexport default () => x;')).toEqual({
      error:
        'A page can\'t import "lodash". It may import @workspace/site-ui, react, react/jsx-runtime.',
      ok: false,
    });
    expect(render("export const Page = () => null;")).toEqual({
      error: "The page has no default export: export the page's component.",
      ok: false,
    });
    expect(render('throw new Error("boom");')).toEqual({
      error: "boom",
      ok: false,
    });
  });

  it.each(examples.map((source, index) => [index, source] as const))(
    "renders the design guide's example %i",
    (_index, source) => {
      const html = render(source);
      expect(typeof html).toBe("string");
      expect(html).toContain("Harbour");
      expect(html).toContain('<nav aria-label="Main"');
    }
  );

  it("renders the blocks with their props, and links as the guide says", () => {
    const html = render(examples[0] ?? "");
    expect(html).toContain("<h1");
    expect(html).toContain("Walks around the old harbour");
    expect(html).toContain('href="about.html"');
    expect(html).toContain('id="pricing"');
    expect(html).toContain("<details");
    // An icon by name, drawn by the instance's set.
    expect(html).toContain("<svg");
  });
});
