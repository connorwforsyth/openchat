// Ported from open-slide (https://github.com/open-slide/open-slide), commit 1f18ab5,
// packages/core/src/editing/batch-edit.test.ts. MIT, Copyright (c) 2026 Yiwei Ho; see LICENSE.open-slide.
import { describe, expect, it } from "vitest";
import { applyEditBatch, type BatchEdit } from "./batch-edit";
import type { EditOp } from "./edit-ops";

function edit(source: string, marker: string, ops: EditOp[]): BatchEdit {
  const offset = source.indexOf(marker);
  if (offset < 0) {
    throw new Error(`Missing target: ${marker}`);
  }
  const before = source.slice(0, offset);
  return {
    column: offset - before.lastIndexOf("\n") - 1,
    line: before.split("\n").length,
    ops,
  };
}

const style = (key: string, value: string): EditOp => ({
  key,
  kind: "set-style",
  value,
});

describe("applyEditBatch", () => {
  it("keeps dependent formatting and typing on text that now matches a sibling", () => {
    const source = "<section><h1>Title</h1><p>Body</p></section>";
    const result = applyEditBatch(source, [
      edit(source, "<h1", [
        { kind: "set-text", prevText: "Title", value: "Body" },
      ]),
      {
        ...edit(source, "<h1", [
          {
            end: 4,
            key: "fontWeight",
            kind: "set-text-range-style",
            prevText: "Body",
            start: 0,
            value: "700",
          },
        ]),
        dependsOn: 0,
      },
      {
        ...edit(source, "<h1", [
          { kind: "set-text", prevText: "Body", value: "Final" },
        ]),
        dependsOn: 1,
      },
    ]);
    expect(result.results).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
    expect(result.source).toBe(
      "<section><h1><span style={{ fontWeight: '700' }}>Final</span></h1><p>Body</p></section>"
    );
  });

  it("keeps whole-element styling on a target after its text matches a sibling", () => {
    const source = "<section><h1>Title</h1><p>Body</p></section>";
    const result = applyEditBatch(source, [
      edit(source, "<h1", [
        { kind: "set-text", prevText: "Title", value: "Body" },
      ]),
      edit(source, "<h1", [
        { key: "color", kind: "set-style", prevText: "Body", value: "red" },
      ]),
      edit(source, "<p", [style("fontSize", "20px")]),
    ]);
    expect(result.results).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
    expect(result.source).toBe(
      "<section><h1 style={{ color: 'red' }}>Body</h1><p style={{ fontSize: '20px' }}>Body</p></section>"
    );
  });

  it("preserves independent reused-component edits alongside a dependent text sequence", () => {
    const source = `function Heading({ title }) { return <h2>{title}</h2>; }
export default () => <section><Heading title="First" /><Heading title="Second" /><p>Body</p></section>;`;
    const result = applyEditBatch(source, [
      edit(source, "<h2", [
        { kind: "set-text", prevText: "First", value: "Body" },
      ]),
      edit(source, "<h2", [
        { kind: "set-text", prevText: "Second", value: "Second updated" },
      ]),
      {
        ...edit(source, "<h2", [
          { kind: "set-text", prevText: "Body", value: "Final" },
        ]),
        dependsOn: 0,
      },
    ]);
    expect(result.results).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
    expect(result.source).toContain('<Heading title="Final" />');
    expect(result.source).toContain('<Heading title="Second updated" />');
    expect(result.source).toContain("<p>Body</p>");
  });

  it("resolves independent text fallbacks separately at the same stale location", () => {
    const source = "<section><h1>Title</h1><p>Body</p></section>";
    const result = applyEditBatch(source, [
      edit(source, "<section", [
        { key: "color", kind: "set-style", prevText: "Title", value: "red" },
      ]),
      edit(source, "<section", [
        { key: "fontSize", kind: "set-style", prevText: "Body", value: "20px" },
      ]),
    ]);
    expect(result.results).toEqual([{ ok: true }, { ok: true }]);
    expect(result.source).toBe(
      "<section><h1 style={{ color: 'red' }}>Title</h1><p style={{ fontSize: '20px' }}>Body</p></section>"
    );
  });

  it("preserves sibling targets when earlier multiline styles collapse", () => {
    const source = `export default () => (
  <section>
    <h1 style={{
      color: 'red',
      fontSize: 40,
    }}>Title</h1>
    <h2 style={{
      color: 'blue',
      fontSize: 20,
    }}>Subtitle</h2>
  </section>
);`;
    const result = applyEditBatch(source, [
      edit(source, "<h1", [style("translate", "20px 10px")]),
      edit(source, "<h2", [style("translate", "40px 30px")]),
    ]);
    expect(result.results).toEqual([{ ok: true }, { ok: true }]);
    expect(result.source).toContain(
      "<h1 style={{ color: 'red', fontSize: 40, translate: '20px 10px' }}>"
    );
    expect(result.source).toContain(
      "<h2 style={{ color: 'blue', fontSize: 20, translate: '40px 30px' }}>"
    );
  });

  it("rebases same-line columns and preserves the request order at the same target", () => {
    const source = "<section><h1>Before</h1><h2>After</h2></section>";
    const result = applyEditBatch(source, [
      edit(source, "<h1", [{ kind: "set-text", value: "After" }]),
      edit(source, "<h2", [style("translate", "80px 0px")]),
      edit(source, "<h1", [
        { ...style("color", "red"), prevText: "Before" } as EditOp,
      ]),
      edit(source, "<h1", [style("color", "green"), style("width", "200px")]),
    ]);
    expect(result.results).toEqual(
      Array.from({ length: 4 }, () => ({ ok: true }))
    );
    expect(result.source).toContain(
      "<h1 style={{ color: 'green', width: '200px' }}>After</h1>"
    );
    expect(result.source).toContain(
      "<h2 style={{ translate: '80px 0px' }}>After</h2>"
    );
  });

  it("tracks nested elements through both ancestor and descendant edits", () => {
    const source = `export default () => (
  <section style={{
    padding: 20,
    background: 'white',
  }}>
    <h1>Title <em>before</em></h1>
    <p>Body</p>
  </section>
);`;
    const result = applyEditBatch(source, [
      edit(source, "<section", [style("translate", "20px 30px")]),
      edit(source, "<em", [{ kind: "set-text", value: "a much longer title" }]),
      edit(source, "<h1", [style("fontSize", "48px")]),
      edit(source, "<p", [style("color", "blue")]),
      edit(source, "<section", [style("background", "black")]),
    ]);
    expect(result.results.every((item) => item.ok)).toBe(true);
    expect(result.source).toContain(
      "<section style={{ padding: 20, background: 'black', translate: '20px 30px' }}>"
    );
    expect(result.source).toContain(
      "<h1 style={{ fontSize: '48px' }}>Title <em>a much longer title</em></h1>"
    );
    expect(result.source).toContain("<p style={{ color: 'blue' }}>Body</p>");
  });

  it("rebases preceding and following targets across prop edits and combined operations", () => {
    const source = `import React from 'react';
export default () => (
  <section>
    <h1 style={{
      color: 'red',
    }}>Title</h1>
    <img alt="first" />
    <img alt="second" />
    <p>Body</p>
  </section>
);`;
    const result = applyEditBatch(source, [
      edit(source, '<img alt="first"', [
        { kind: "set-prop", prop: "src", value: "photo.png" },
        style("width", "180px"),
      ]),
      edit(source, "<h1", [style("translate", "30px 40px")]),
      edit(source, '<img alt="second"', [
        { kind: "set-prop", prop: "alt", value: "Second" },
      ]),
      edit(source, "<p", [{ kind: "set-text", value: "Updated" }]),
      edit(source, '<img alt="first"', [style("height", "120px")]),
    ]);
    expect(result.results.every((item) => item.ok)).toBe(true);
    expect(result.source).toContain(
      "<img alt=\"first\" src=\"photo.png\" style={{ width: '180px', height: '120px' }} />"
    );
    expect(result.source).toContain('<img alt="Second" />');
    expect(result.source).toContain(
      "<h1 style={{ color: 'red', translate: '30px 40px' }}>Title</h1>"
    );
    expect(result.source).toContain("<p>Updated</p>");
  });

  it("returns failures in input order without shifting targets or applying partial edits", () => {
    const source = "<section><h1>Title</h1><p>Body</p></section>";
    const result = applyEditBatch(source, [
      { line: 0, ops: [style("color", "red")] },
      edit(source, "<p", [style("color", "blue")]),
      edit(source, "<h1", [
        style("color", "red"),
        { kind: "set-prop", prop: "items.0", value: "x" },
      ]),
      { column: 0, line: 99, ops: [style("width", "10px")] },
      edit(source, "<h1", [style("height", "80px")]),
    ]);
    expect(result.results).toEqual([
      { error: "invalid edit", ok: false },
      { ok: true },
      { error: 'prop "items" is missing, so it has no element 0', ok: false },
      { error: "no JSX element at location", ok: false },
      { ok: true },
    ]);
    expect(result.source).toContain(
      "<h1 style={{ height: '80px' }}>Title</h1>"
    );
    expect(result.source).toContain("<p style={{ color: 'blue' }}>Body</p>");
    expect(result.source).not.toContain("color: 'red'");
  });

  it("stops a failed text sequence while saving its successful prefix and independent edits", () => {
    const source = "<section><h1>Title</h1><p>Body</p></section>";
    const result = applyEditBatch(source, [
      edit(source, "<p", [
        { kind: "set-text", prevText: "Body", value: "Body first" },
      ]),
      {
        ...edit(source, "<p", [
          {
            end: 4,
            key: "fontWeight",
            kind: "set-text-range-style",
            prevText: "Body first",
            start: -1,
            value: "700",
          },
        ]),
        dependsOn: 0,
      },
      {
        ...edit(source, "<p", [
          { kind: "set-text", prevText: "Body first", value: "Body final" },
        ]),
        dependsOn: 1,
      },
      edit(source, "<h1", [style("color", "blue")]),
      {
        ...edit(source, "<p", [
          { kind: "set-text", prevText: "Body final", value: "Body last" },
        ]),
        dependsOn: 2,
      },
    ]);
    expect(result.results).toEqual([
      { ok: true },
      { error: "invalid text range", ok: false },
      { error: "an earlier edit for this text failed", ok: false },
      { ok: true },
      { error: "an earlier edit for this text failed", ok: false },
    ]);
    expect(result.source).toContain("<p>Body first</p>");
    expect(result.source).toContain("<h1 style={{ color: 'blue' }}>Title</h1>");
    expect(result.source).not.toContain("fontWeight");
  });

  it("rejects dependencies that do not refer to an earlier edit", () => {
    const source = "<p>Body</p>";
    const result = applyEditBatch(source, [
      { ...edit(source, "<p", [style("color", "red")]), dependsOn: 0 },
      { ...edit(source, "<p", [style("color", "red")]), dependsOn: -1 },
      { ...edit(source, "<p", [style("color", "red")]), dependsOn: 1.5 },
      { ...edit(source, "<p", [style("color", "red")]), dependsOn: 4 },
      { ...edit(source, "<p", []), dependsOn: 0 },
      edit(source, "<p", [style("color", "blue")]),
    ]);
    expect(result.results).toEqual([
      { error: "invalid edit", ok: false },
      { error: "invalid edit", ok: false },
      { error: "invalid edit", ok: false },
      { error: "invalid edit", ok: false },
      { error: "an earlier edit for this text failed", ok: false },
      { ok: true },
    ]);
    expect(result.source).toBe("<p style={{ color: 'blue' }}>Body</p>");
  });
});
