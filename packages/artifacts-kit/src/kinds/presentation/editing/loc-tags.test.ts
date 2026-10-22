// Ported from open-slide (https://github.com/open-slide/open-slide), commit 1f18ab5,
// packages/core/src/vite/loc-tags-plugin.test.ts (`injectLocTags` cases). MIT, Copyright (c) 2026 Yiwei Ho; see LICENSE.open-slide.
import { describe, expect, it } from "vitest";
import { injectLocTags } from "./loc-tags";

const FILE = "slides/intro.tsx";

describe("injectLocTags", () => {
  it("adds data-src to host elements with the file and JSX start position", () => {
    const src = [
      "export default [() => (",
      "  <div>hello</div>",
      ")];",
      "",
    ].join("\n");
    expect(injectLocTags(src, FILE)).toContain(
      '<div data-src="slides/intro.tsx:2:2">hello</div>'
    );
  });

  it("tags capitalized component invocations", () => {
    const src = [
      "export default [() => (",
      "  <MyComp>hi</MyComp>",
      ")];",
      "",
    ].join("\n");
    expect(injectLocTags(src, FILE)).toContain(
      '<MyComp data-src="slides/intro.tsx:2:2">hi</MyComp>'
    );
  });

  it("tags every element including nested ones", () => {
    const src = [
      "export default [() => (",
      "  <Layout>",
      "    <h1>Hi</h1>",
      "    <SubBox><span>nested</span></SubBox>",
      "  </Layout>",
      ")];",
      "",
    ].join("\n");
    const out = injectLocTags(src, FILE);
    expect(out).toContain('<Layout data-src="slides/intro.tsx:2:2">');
    expect(out).toContain('<h1 data-src="slides/intro.tsx:3:4">Hi</h1>');
    expect(out).toContain(
      '<SubBox data-src="slides/intro.tsx:4:4"><span data-src="slides/intro.tsx:4:12">nested</span></SubBox>'
    );
  });

  it("skips fragments and member-expression tags", () => {
    const src = [
      "export default () => (",
      "  <>",
      "    <Fragment><b>x</b></Fragment>",
      "    <React.Fragment>y</React.Fragment>",
      "    <motion.div>z</motion.div>",
      "  </>",
      ");",
    ].join("\n");
    const out = injectLocTags(src, FILE);
    expect(out).toContain(
      '<Fragment><b data-src="slides/intro.tsx:3:14">x</b></Fragment>'
    );
    expect(out).toContain("<React.Fragment>y</React.Fragment>");
    expect(out).toContain("<motion.div>z</motion.div>");
    expect(out).toContain("  <>\n");
  });

  it("skips elements that already have data-src", () => {
    const src = [
      "export default [() => (",
      '  <div data-src="a.tsx:1">already</div>',
      ")];",
    ].join("\n");
    expect(injectLocTags(src, FILE)).toBeNull();
  });

  it("inserts after the tag name, before any other attributes", () => {
    const src = [
      "export default [() => (",
      '  <div className="foo">x</div>',
      ")];",
      "",
    ].join("\n");
    expect(injectLocTags(src, FILE)).toContain(
      '<div data-src="slides/intro.tsx:2:2" className="foo">x</div>'
    );
  });

  it("handles self-closing elements", () => {
    const src = [
      "export default [() => (",
      '  <img src="x" />',
      ")];",
      "",
    ].join("\n");
    expect(injectLocTags(src, FILE)).toContain(
      '<img data-src="slides/intro.tsx:2:2" src="x" />'
    );
  });

  it("returns null when source has no elements", () => {
    expect(injectLocTags("const x = 1;", FILE)).toBeNull();
  });

  it("returns null when source does not parse", () => {
    expect(injectLocTags("export default () => <div", FILE)).toBeNull();
  });
});
