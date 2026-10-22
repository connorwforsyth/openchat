// Ported from open-slide (https://github.com/open-slide/open-slide), commit 1f18ab5,
// packages/core/src/editing/edit-ops.test.ts. MIT, Copyright (c) 2026 Yiwei Ho; see LICENSE.open-slide.
import { describe, expect, it } from "vitest";
import { applyEdit } from "./edit-ops";

describe("applyEdit / set-style", () => {
  // Every JSX opening tag in these synthetic sources sits at column 0;
  // the line numbers below are that tag's line (1-indexed).
  it("inserts a new style attribute when none exists", () => {
    const src = ["export default [() => (", "<h1>Hello</h1>", ")];", ""].join(
      "\n"
    );
    const r = applyEdit(src, 2, 0, [
      { key: "color", kind: "set-style", value: "tomato" },
    ]);
    if (!r.ok) {
      throw new Error(`expected ok, got ${r.error}`);
    }
    expect(r.source).toBe(
      [
        "export default [() => (",
        "<h1 style={{ color: 'tomato' }}>Hello</h1>",
        ")];",
        "",
      ].join("\n")
    );
  });

  it("updates an existing style key in place", () => {
    const src = [
      "export default [() => (",
      "<h1 style={{ color: 'red' }}>Hi</h1>",
      ")];",
      "",
    ].join("\n");
    const r = applyEdit(src, 2, 0, [
      { key: "color", kind: "set-style", value: "lime" },
    ]);
    if (!r.ok) {
      throw new Error(`expected ok, got ${r.error}`);
    }
    expect(r.source).toContain("style={{ color: 'lime' }}");
  });

  it("adds a new key alongside existing keys", () => {
    const src = [
      "export default [() => (",
      "<h1 style={{ color: 'red' }}>Hi</h1>",
      ")];",
      "",
    ].join("\n");
    const r = applyEdit(src, 2, 0, [
      { key: "fontSize", kind: "set-style", value: "24px" },
    ]);
    if (!r.ok) {
      throw new Error(`expected ok, got ${r.error}`);
    }
    expect(r.source).toContain("style={{ color: 'red', fontSize: '24px' }}");
  });

  it("falls back to prevText for text style edits with a stale source location", () => {
    const src = [
      "export default [() => (",
      "<div>",
      "  <h1>",
      "    Claude",
      "    <br />",
      "    <em style={{ color: 'var(--osd-accent)' }}>Code.</em>",
      "  </h1>",
      "</div>",
      ")];",
      "",
    ].join("\n");
    const r = applyEdit(src, 2, 0, [
      {
        key: "fontSize",
        kind: "set-style",
        prevText: "Claude\nCode.",
        value: "24px",
      },
    ]);
    if (!r.ok) {
      throw new Error(`expected ok, got ${r.error}`);
    }
    expect(r.source).toContain("<h1 style={{ fontSize: '24px' }}>");
  });

  it("removes a key when value is null", () => {
    const src = [
      "export default [() => (",
      "<h1 style={{ color: 'red', fontSize: '24px' }}>Hi</h1>",
      ")];",
      "",
    ].join("\n");
    const r = applyEdit(src, 2, 0, [
      { key: "fontSize", kind: "set-style", value: null },
    ]);
    if (!r.ok) {
      throw new Error(`expected ok, got ${r.error}`);
    }
    expect(r.source).toContain("style={{ color: 'red' }}");
    expect(r.source).not.toContain("fontSize");
  });

  it("removes the entire style attribute when the last property is cleared", () => {
    const src = [
      "export default [() => (",
      "<h1 style={{ color: 'red' }}>Hi</h1>",
      ")];",
      "",
    ].join("\n");
    const r = applyEdit(src, 2, 0, [
      { key: "color", kind: "set-style", value: null },
    ]);
    if (!r.ok) {
      throw new Error(`expected ok, got ${r.error}`);
    }
    expect(r.source).toContain("<h1>Hi</h1>");
    expect(r.source).not.toContain("style");
  });

  it("preserves variable-valued properties when editing other keys", () => {
    const src = [
      "export default [() => (",
      '<h1 style={{ fontSize: someVar, color: "red" }}>Hi</h1>',
      ")];",
      "",
    ].join("\n");
    const r = applyEdit(src, 2, 0, [
      { key: "color", kind: "set-style", value: "blue" },
    ]);
    if (!r.ok) {
      throw new Error(`expected ok, got ${r.error}`);
    }
    expect(r.source).toContain("style={{ fontSize: someVar, color: 'blue' }}");
  });

  it("preserves dynamic style expressions when adding an override", () => {
    const src = [
      "export default [() => (",
      "<h1 style={someStyle}>Hi</h1>",
      ")];",
      "",
    ].join("\n");
    const r = applyEdit(src, 2, 0, [
      { key: "color", kind: "set-style", value: "red" },
    ]);
    if (!r.ok) {
      throw new Error(`expected ok, got ${r.error}`);
    }
    expect(r.source).toContain("style={{ ...(someStyle), color: 'red' }}");
  });

  it("adds style keys after spreads so they override spread values", () => {
    const src = [
      "export default [() => (",
      "<h1 style={{ ...base }}>Hi</h1>",
      ")];",
      "",
    ].join("\n");
    const r = applyEdit(src, 2, 0, [
      { key: "color", kind: "set-style", value: "red" },
    ]);
    if (!r.ok) {
      throw new Error(`expected ok, got ${r.error}`);
    }
    expect(r.source).toContain("style={{ ...base, color: 'red' }}");
  });

  it("updates explicit style keys while preserving spreads", () => {
    const src = [
      "export default [() => (",
      "<h1 style={{ ...base, color: 'red' }}>Hi</h1>",
      ")];",
      "",
    ].join("\n");
    const r = applyEdit(src, 2, 0, [
      { key: "color", kind: "set-style", value: "blue" },
    ]);
    if (!r.ok) {
      throw new Error(`expected ok, got ${r.error}`);
    }
    expect(r.source).toContain("style={{ ...base, color: 'blue' }}");
  });

  it("removes explicit style keys while still overriding spread values", () => {
    const src = [
      "export default [() => (",
      "<h1 style={{ ...base, color: 'red' }}>Hi</h1>",
      ")];",
      "",
    ].join("\n");
    const r = applyEdit(src, 2, 0, [
      { key: "color", kind: "set-style", value: null },
    ]);
    if (!r.ok) {
      throw new Error(`expected ok, got ${r.error}`);
    }
    expect(r.source).toContain("style={{ ...base, color: undefined }}");
  });

  it("places new style attributes after prop spreads", () => {
    const src = [
      "export default [() => (",
      "<h1 {...props}>Hi</h1>",
      ")];",
      "",
    ].join("\n");
    const r = applyEdit(src, 2, 0, [
      { key: "color", kind: "set-style", value: "red" },
    ]);
    if (!r.ok) {
      throw new Error(`expected ok, got ${r.error}`);
    }
    expect(r.source).toContain(
      "<h1 {...props} style={{ color: 'red' }}>Hi</h1>"
    );
  });

  it("moves existing style attributes after later prop spreads", () => {
    const src = [
      "export default [() => (",
      "<h1 style={{ fontSize: '24px' }} {...props}>Hi</h1>",
      ")];",
      "",
    ].join("\n");
    const r = applyEdit(src, 2, 0, [
      { key: "color", kind: "set-style", value: "red" },
    ]);
    if (!r.ok) {
      throw new Error(`expected ok, got ${r.error}`);
    }
    expect(r.source).toContain(
      "<h1 {...props} style={{ fontSize: '24px', color: 'red' }}>Hi</h1>"
    );
  });

  it("escapes special characters in style values", () => {
    const src = ["export default [() => (", "<h1>Hi</h1>", ")];", ""].join(
      "\n"
    );
    const r = applyEdit(src, 2, 0, [
      { key: "fontFamily", kind: "set-style", value: "Pacifico's" },
    ]);
    if (!r.ok) {
      throw new Error(`expected ok, got ${r.error}`);
    }
    expect(r.source).toContain("fontFamily: 'Pacifico\\'s'");
  });
});

describe("applyEdit / set-text", () => {
  it("replaces a JSXText child", () => {
    const src = ["export default [() => (", "<h1>Hello</h1>", ")];", ""].join(
      "\n"
    );
    const r = applyEdit(src, 2, 0, [{ kind: "set-text", value: "Goodbye" }]);
    if (!r.ok) {
      throw new Error(`expected ok, got ${r.error}`);
    }
    expect(r.source).toContain("<h1>Goodbye</h1>");
  });

  it("replaces a string-literal expression child", () => {
    const src = [
      "export default [() => (",
      "<h1>{'Hello'}</h1>",
      ")];",
      "",
    ].join("\n");
    const r = applyEdit(src, 2, 0, [{ kind: "set-text", value: "Goodbye" }]);
    if (!r.ok) {
      throw new Error(`expected ok, got ${r.error}`);
    }
    expect(r.source).toContain("<h1>{'Goodbye'}</h1>");
  });

  it("emits an expression container when value contains JSX-unsafe chars", () => {
    const src = ["export default [() => (", "<h1>Hello</h1>", ")];", ""].join(
      "\n"
    );
    const r = applyEdit(src, 2, 0, [{ kind: "set-text", value: "1 < 2 > 0" }]);
    if (!r.ok) {
      throw new Error(`expected ok, got ${r.error}`);
    }
    expect(r.source).toContain("<h1>{'1 < 2 > 0'}</h1>");
  });

  it("preserves inserted line breaks as JSX breaks", () => {
    const src = ["export default [() => (", "<h1>Hello</h1>", ")];", ""].join(
      "\n"
    );
    const r = applyEdit(src, 2, 0, [
      { kind: "set-text", prevText: "Hello", value: "Hello\nworld" },
    ]);
    if (!r.ok) {
      throw new Error(`expected ok, got ${r.error}`);
    }
    expect(r.source).toContain("<h1>Hello<br />world</h1>");
  });

  it("descends through wrapper elements to find the text leaf", () => {
    const src = [
      "export default [() => (",
      "<div><span>Hello</span></div>",
      ")];",
      "",
    ].join("\n");
    const r = applyEdit(src, 2, 0, [{ kind: "set-text", value: "Goodbye" }]);
    if (!r.ok) {
      throw new Error(`expected ok, got ${r.error}`);
    }
    expect(r.source).toContain("<div><span>Goodbye</span></div>");
  });

  it("disambiguates between sibling text leaves via prevText", () => {
    const src = [
      "export default [() => (",
      "<h1>Hello <span>world</span></h1>",
      ")];",
      "",
    ].join("\n");
    const r = applyEdit(src, 2, 0, [
      { kind: "set-text", prevText: "world", value: "planet" },
    ]);
    if (!r.ok) {
      throw new Error(`expected ok, got ${r.error}`);
    }
    expect(r.source).toContain("<h1>Hello <span>planet</span></h1>");
  });

  it("falls back to prevText for multiline content edits with a stale source location", () => {
    const src = [
      "const fill = {",
      "  color: 'var(--osd-text)',",
      "};",
      "export default [() => (",
      "<section style={fill}>",
      "<p>Alpha<br />Beta</p>",
      "</section>",
      ")];",
      "",
    ].join("\n");
    const r = applyEdit(src, 2, 2, [
      {
        kind: "set-text",
        prevText: "Alpha\nBeta",
        value: "Alpha\nBeta\nGamma",
      },
    ]);
    if (!r.ok) {
      throw new Error(`expected ok, got ${r.error}`);
    }
    expect(r.source).toContain("<p>Alpha<br />Beta<br />Gamma</p>");
  });

  it("applies selected text style to an existing inline leaf", () => {
    const src = [
      "export default [() => (",
      "<h2>",
      "  Not autocomplete.",
      "  <br />",
      "  An <em style={{ color: 'var(--osd-accent)' }}>agent</em> that does the work.",
      "</h2>",
      ")];",
      "",
    ].join("\n");
    const prevText = "Not autocomplete.\nAn agent that does the work.";
    const start = prevText.indexOf("agent");
    const r = applyEdit(src, 2, 0, [
      {
        end: start + "agent".length,
        key: "color",
        kind: "set-text-range-style",
        prevText,
        start,
        value: "peru",
      },
    ]);
    if (!r.ok) {
      throw new Error(`expected ok, got ${r.error}`);
    }
    expect(r.source).toContain("<em style={{ color: 'peru' }}>agent</em>");
  });

  it("does not style sibling content when a selected leaf has mixed parent content", () => {
    const src = [
      "export default [() => (",
      "<h1><span>Hello <strong>world</strong></span></h1>",
      ")];",
      "",
    ].join("\n");
    const r = applyEdit(src, 2, 0, [
      {
        end: "Hello".length,
        key: "color",
        kind: "set-text-range-style",
        prevText: "Hello world",
        start: 0,
        value: "peru",
      },
    ]);
    if (!r.ok) {
      throw new Error(`expected ok, got ${r.error}`);
    }
    expect(r.source).toContain(
      "<span><span style={{ color: 'peru' }}>Hello</span> <strong>world</strong></span>"
    );
    expect(r.source).not.toContain(
      "<span style={{ color: 'peru' }}>Hello <strong>world"
    );
  });

  it("applies selected text style across inline and plain text leaves", () => {
    const src = [
      "export default [() => (",
      "<h2>",
      "  Not autocomplete.",
      "  <br />",
      "  An <em style={{ color: 'var(--osd-accent)' }}>agent</em> that does the work.",
      "</h2>",
      ")];",
      "",
    ].join("\n");
    const prevText = "Not autocomplete.\nAn agent that does the work.";
    const start = prevText.indexOf("agent");
    const r = applyEdit(src, 2, 0, [
      {
        end: start + "agent that".length,
        key: "color",
        kind: "set-text-range-style",
        prevText,
        start,
        value: "peru",
      },
    ]);
    if (!r.ok) {
      throw new Error(`expected ok, got ${r.error}`);
    }
    expect(r.source).toContain("<em style={{ color: 'peru' }}>agent</em>");
    expect(r.source).toContain(
      "<span style={{ color: 'peru' }}>{' that'}</span> does"
    );
  });

  it("applies selected text style inside folded JSX text", () => {
    const src = [
      "export default [() => (",
      "<p>",
      "  Claude Code reads your codebase, plans, edits files, runs commands, checks the result, and",
      "  iterates — keeping you in the loop on the decisions that matter.",
      "</p>",
      ")];",
      "",
    ].join("\n");
    const prevText =
      "Claude Code reads your codebase, plans, edits files, runs commands, checks the result, and iterates — keeping you in the loop on the decisions that matter.";
    const start = prevText.indexOf("iterates");
    const r = applyEdit(src, 2, 0, [
      {
        end: start + "iterates".length,
        key: "fontWeight",
        kind: "set-text-range-style",
        prevText,
        start,
        value: "700",
      },
    ]);
    if (!r.ok) {
      throw new Error(`expected ok, got ${r.error}`);
    }
    expect(r.source).toContain(
      "<span style={{ fontWeight: '700' }}>iterates</span>"
    );
  });

  it("updates selected text style after a plain text leaf has been wrapped", () => {
    const src = [
      "export default [() => (",
      "<h2>",
      "  Not autocomplete.",
      "  <br />",
      "  An <em style={{ color: 'peru' }}>agent</em><span style={{ color: 'peru' }}>{' that'}</span> does the work.",
      "</h2>",
      ")];",
      "",
    ].join("\n");
    const prevText = "Not autocomplete.\nAn agent that does the work.";
    const start = prevText.indexOf("agent");
    const r = applyEdit(src, 2, 0, [
      {
        end: start + "agent that".length,
        key: "color",
        kind: "set-text-range-style",
        prevText,
        start,
        value: "black",
      },
    ]);
    if (!r.ok) {
      throw new Error(`expected ok, got ${r.error}`);
    }
    expect(r.source).toContain("<em style={{ color: 'black' }}>agent</em>");
    expect(r.source).toContain(
      "<span style={{ color: 'black' }}>{' that'}</span> does"
    );
  });

  it("removes selected text style from a fully selected inline leaf", () => {
    const src = [
      "export default [() => (",
      "<h2>",
      "  <span style={{ fontWeight: '700' }}>agent</span> work.",
      "</h2>",
      ")];",
      "",
    ].join("\n");
    const r = applyEdit(src, 2, 0, [
      {
        end: "agent".length,
        key: "fontWeight",
        kind: "set-text-range-style",
        prevText: "agent work.",
        start: 0,
        value: null,
      },
    ]);
    if (!r.ok) {
      throw new Error(`expected ok, got ${r.error}`);
    }
    expect(r.source).toContain("<span>agent</span> work.");
  });

  it("resets selected text style inside an inherited bold range", () => {
    const src = [
      "export default [() => (",
      "<h2 style={{ fontWeight: '700' }}>An agent that works.</h2>",
      ")];",
      "",
    ].join("\n");
    const prevText = "An agent that works.";
    const start = prevText.indexOf("agent");
    const r = applyEdit(src, 2, 0, [
      {
        end: start + "agent".length,
        key: "fontWeight",
        kind: "set-text-range-style",
        prevText,
        start,
        value: null,
      },
    ]);
    if (!r.ok) {
      throw new Error(`expected ok, got ${r.error}`);
    }
    expect(r.source).toContain(
      "<span style={{ fontWeight: '400' }}>agent</span>"
    );
  });

  it("falls back to prevText when a stale source location no longer points at JSX", () => {
    const src = [
      "export default [() => (",
      "<h1>",
      "  <span style={{ fontStyle: 'italic' }}>Claude</span>",
      "  <br />",
      "  <em style={{ color: 'var(--osd-accent)' }}>Code.</em>",
      "</h1>",
      ")];",
      "",
    ].join("\n");
    const r = applyEdit(src, 99, 0, [
      {
        end: "Claude".length,
        key: "fontSize",
        kind: "set-text-range-style",
        prevText: "Claude\nCode.",
        start: 0,
        value: "180px",
      },
    ]);
    if (!r.ok) {
      throw new Error(`expected ok, got ${r.error}`);
    }
    expect(r.source).toContain(
      "<span style={{ fontStyle: 'italic', fontSize: '180px' }}>"
    );
  });

  it("falls back to prevText for direct JSX text with a stale source location", () => {
    const src = [
      "export default [() => (",
      "<h1>",
      "  Claude",
      "  <br />",
      "  <em style={{ color: 'var(--osd-accent)' }}>Code.</em>",
      "</h1>",
      ")];",
      "",
    ].join("\n");
    const r = applyEdit(src, 99, 0, [
      {
        end: "Claude".length,
        key: "fontSize",
        kind: "set-text-range-style",
        prevText: "Claude\nCode.",
        start: 0,
        value: "180px",
      },
    ]);
    if (!r.ok) {
      throw new Error(`expected ok, got ${r.error}`);
    }
    expect(r.source).toContain(
      "<span style={{ fontSize: '180px' }}>Claude</span>"
    );
  });

  it("falls back to prevText when a stale location points at an outer JSX element", () => {
    const src = [
      "export default [() => (",
      "<div>",
      "  <h1>",
      "    Claude",
      "    <br />",
      "    <em style={{ color: 'var(--osd-accent)' }}>Code.</em>",
      "  </h1>",
      "</div>",
      ")];",
      "",
    ].join("\n");
    const r = applyEdit(src, 2, 0, [
      {
        end: "Claude".length,
        key: "fontSize",
        kind: "set-text-range-style",
        prevText: "Claude\nCode.",
        start: 0,
        value: "180px",
      },
    ]);
    if (!r.ok) {
      throw new Error(`expected ok, got ${r.error}`);
    }
    expect(r.source).toContain(
      "<span style={{ fontSize: '180px' }}>Claude</span>"
    );
  });

  it("styles the whole element when selected map text is expression-backed", () => {
    const src = [
      "const items = [",
      "  { title: 'Read files' },",
      "  { title: 'Run tools' },",
      "];",
      "export default [() => (",
      "<div>",
      "  {items.map((item) => (",
      "    <div key={item.title}>",
      "      <div style={{ fontWeight: 400 }}>{item.title}</div>",
      "    </div>",
      "  ))}",
      "</div>",
      ")];",
      "",
    ].join("\n");
    const r = applyEdit(src, 9, 6, [
      {
        end: "Run tools".length,
        key: "fontSize",
        kind: "set-text-range-style",
        prevText: "Run tools",
        start: 0,
        value: "79px",
      },
    ]);
    if (!r.ok) {
      throw new Error(`expected ok, got ${r.error}`);
    }
    expect(r.source).toContain("style={{ fontWeight: 400, fontSize: '79px' }}");
  });

  it("falls back to element style for partial expression-backed map text", () => {
    const src = [
      "const steps = [",
      "  { label: 'Read' },",
      "  { label: 'Plan' },",
      "];",
      "export default [() => (",
      "<div>",
      "  {steps.map((step) => (",
      "    <div key={step.label} style={{ fontWeight: 400 }}>{step.label}</div>",
      "  ))}",
      "</div>",
      ")];",
      "",
    ].join("\n");
    const r = applyEdit(src, 8, 4, [
      {
        end: 3,
        key: "fontSize",
        kind: "set-text-range-style",
        prevText: "Plan",
        start: 1,
        value: "81px",
      },
    ]);
    if (!r.ok) {
      throw new Error(`expected ok, got ${r.error}`);
    }
    expect(r.source).toContain("style={{ fontWeight: 400, fontSize: '81px' }}");
  });

  it("edits rich text content without flattening inline style", () => {
    const src = [
      "export default [() => (",
      "<h2>",
      "  Not autocomplete.",
      "  <br />",
      "  An <em style={{ color: 'var(--osd-accent)' }}>agent</em> that does the work.",
      "</h2>",
      ")];",
      "",
    ].join("\n");
    const r = applyEdit(src, 2, 0, [
      {
        kind: "set-text",
        prevText: "Not autocomplete.\nAn agent that does the work.",
        value: "Not autocomplete.\nAn agent that does the real work.",
      },
    ]);
    if (!r.ok) {
      throw new Error(`expected ok, got ${r.error}`);
    }
    expect(r.source).toContain(
      "<em style={{ color: 'var(--osd-accent)' }}>agent</em>"
    );
    expect(r.source).toContain("that does the real work.");
    expect(r.source).toContain("<br />");
  });

  it("edits rich text line breaks as newlines", () => {
    const src = [
      "export default [() => (",
      "<h2>",
      "  Not autocomplete.",
      "  <br />",
      "  An <em style={{ color: 'var(--osd-accent)' }}>agent</em> that does the work.",
      "</h2>",
      ")];",
      "",
    ].join("\n");
    const r = applyEdit(src, 2, 0, [
      {
        kind: "set-text",
        prevText: "Not autocomplete.\nAn agent that does the work.",
        value: "Not autocomplete. An agent that does the work.",
      },
    ]);
    if (!r.ok) {
      throw new Error(`expected ok, got ${r.error}`);
    }
    expect(r.source).not.toContain("<br />");
    expect(r.source).toContain("{' '}");
    expect(r.source).toContain(
      "<em style={{ color: 'var(--osd-accent)' }}>agent</em>"
    );
  });

  it("matches visible rich text when a string literal has whitespace before a line break", () => {
    const src = [
      "export default [() => (",
      "<h2>",
      "  an <span>agent <span>harness</span></span> is{' '}",
      "  <span>",
      "    {'\"everything '}<br />in an AI agent except the model itself.\"",
      "  </span>",
      "</h2>",
      ")];",
      "",
    ].join("\n");
    const prevText =
      'an agent harness is "everything\nin an AI agent except the model itself."';
    const r = applyEdit(src, 2, 0, [
      {
        kind: "set-text",
        prevText,
        value:
          'an agent harness is "everything\nin a coding agent except the model itself."',
      },
    ]);
    if (!r.ok) {
      throw new Error(`expected ok, got ${r.error}`);
    }
    expect(r.source).toContain("in a coding agent except the model itself.");
    expect(r.source).toContain("<br />");
  });

  it("matches rich text content after line break positions changed in a pending edit", () => {
    const src = [
      "export default [() => (",
      "<h2>",
      "  Permissions, t<br />hen hooks.",
      "</h2>",
      ")];",
      "",
    ].join("\n");
    const r = applyEdit(src, 2, 0, [
      {
        kind: "set-text",
        prevText: "Permissions, then hooks.",
        value: "Permissions, t\nhen hooks!",
      },
    ]);
    if (!r.ok) {
      throw new Error(`expected ok, got ${r.error}`);
    }
    expect(r.source).toContain("hen hooks!");
    expect(r.source).toContain("<br />");
  });

  it("styles visible rich text when a string literal has whitespace before a line break", () => {
    const src = [
      "export default [() => (",
      "<h2>",
      "  an <span>agent <span>harness</span></span> is{' '}",
      "  <span>",
      "    {'\"everything '}<br />in an AI agent except the model itself.\"",
      "  </span>",
      "</h2>",
      ")];",
      "",
    ].join("\n");
    const prevText =
      'an agent harness is "everything\nin an AI agent except the model itself."';
    const start = prevText.indexOf("in an AI");
    const r = applyEdit(src, 2, 0, [
      {
        end: start + "in an AI".length,
        key: "fontWeight",
        kind: "set-text-range-style",
        prevText,
        start,
        value: "700",
      },
    ]);
    if (!r.ok) {
      throw new Error(`expected ok, got ${r.error}`);
    }
    expect(r.source).toContain(
      "<span style={{ fontWeight: '700' }}>in an AI</span>"
    );
  });

  it("bails when prevText is missing for an ambiguous element", () => {
    const src = [
      "export default [() => (",
      "<h1>Hello <span>world</span></h1>",
      ")];",
      "",
    ].join("\n");
    const r = applyEdit(src, 2, 0, [{ kind: "set-text", value: "Goodbye" }]);
    expect(r.ok).toBe(false);
    if (r.ok) {
      throw new Error("expected failure");
    }
    expect(r.status).toBe(422);
    expect(r.error).toMatch("multiple text candidates");
  });

  it("bails when prevText matches no candidate", () => {
    const src = [
      "export default [() => (",
      "<h1>Hello <span>world</span></h1>",
      ")];",
      "",
    ].join("\n");
    const r = applyEdit(src, 2, 0, [
      { kind: "set-text", prevText: "nothing-like-this", value: "Goodbye" },
    ]);
    expect(r.ok).toBe(false);
    if (r.ok) {
      throw new Error("expected failure");
    }
    expect(r.status).toBe(422);
    expect(r.error).toMatch("no text candidate matches");
  });

  it("bails when prevText matches multiple identical candidates", () => {
    const src = [
      "export default [() => (",
      "<h1>X<span>X</span></h1>",
      ")];",
      "",
    ].join("\n");
    const r = applyEdit(src, 2, 0, [
      { kind: "set-text", prevText: "X", value: "Y" },
    ]);
    expect(r.ok).toBe(false);
    if (r.ok) {
      throw new Error("expected failure");
    }
    expect(r.status).toBe(422);
    expect(r.error).toMatch("cannot disambiguate");
  });

  it("edits the JSXText child of a component invocation", () => {
    const src = [
      "export default [() => (",
      "<Title>Hello</Title>",
      ")];",
      "",
    ].join("\n");
    const r = applyEdit(src, 2, 0, [{ kind: "set-text", value: "Goodbye" }]);
    if (!r.ok) {
      throw new Error(`expected ok, got ${r.error}`);
    }
    expect(r.source).toContain("<Title>Goodbye</Title>");
  });

  it("bails when element child is a dynamic expression", () => {
    const src = ["export default [() => (", "<h1>{name}</h1>", ")];", ""].join(
      "\n"
    );
    const r = applyEdit(src, 2, 0, [{ kind: "set-text", value: "Goodbye" }]);
    expect(r.ok).toBe(false);
    if (r.ok) {
      throw new Error("expected failure");
    }
    expect(r.status).toBe(422);
  });

  it("bails when a self-closing element has no editable text", () => {
    const src = [
      "export default [() => (",
      '<MyComp title="x" />',
      ")];",
      "",
    ].join("\n");
    const r = applyEdit(src, 2, 0, [{ kind: "set-text", value: "Goodbye" }]);
    expect(r.ok).toBe(false);
    if (r.ok) {
      throw new Error("expected failure");
    }
    expect(r.status).toBe(422);
    expect(r.error).toMatch("no editable text");
  });

  it("falls through to call sites when the element is a {children} slot", () => {
    // The host `<div>` at line 2 only renders `{children}`; the actual
    // text lives at the unique call site below.
    const src = [
      "const Eyebrow = ({ children }) => (",
      "  <div>{children}</div>",
      ");",
      "export default [() => (",
      "  <Eyebrow>Hello</Eyebrow>",
      ")];",
      "",
    ].join("\n");
    const r = applyEdit(src, 2, 2, [
      { kind: "set-text", prevText: "Hello", value: "Goodbye" },
    ]);
    if (!r.ok) {
      throw new Error(`expected ok, got ${r.error}`);
    }
    expect(r.source).toContain("<Eyebrow>Goodbye</Eyebrow>");
    expect(r.source).toContain("<div>{children}</div>");
  });

  it("disambiguates between sibling call sites of a children-slot component", () => {
    const src = [
      "const Eyebrow = ({ children }) => (",
      "  <div>{children}</div>",
      ");",
      "export default [() => (",
      "  <section>",
      "    <Eyebrow>One</Eyebrow>",
      "    <Eyebrow>Two</Eyebrow>",
      "  </section>",
      ")];",
      "",
    ].join("\n");
    const r = applyEdit(src, 2, 2, [
      { kind: "set-text", prevText: "Two", value: "Second" },
    ]);
    if (!r.ok) {
      throw new Error(`expected ok, got ${r.error}`);
    }
    expect(r.source).toContain("<Eyebrow>One</Eyebrow>");
    expect(r.source).toContain("<Eyebrow>Second</Eyebrow>");
  });

  it("bails on a children-slot element when prevText is missing and call sites differ", () => {
    const src = [
      "const Eyebrow = ({ children }) => (",
      "  <div>{children}</div>",
      ");",
      "export default [() => (",
      "  <section>",
      "    <Eyebrow>One</Eyebrow>",
      "    <Eyebrow>Two</Eyebrow>",
      "  </section>",
      ")];",
      "",
    ].join("\n");
    const r = applyEdit(src, 2, 2, [{ kind: "set-text", value: "X" }]);
    expect(r.ok).toBe(false);
    if (r.ok) {
      throw new Error("expected failure");
    }
    expect(r.status).toBe(422);
    expect(r.error).toMatch("multiple text candidates");
  });

  it("routes a prop pass-through edit to the matching call site", () => {
    // `<h2>{title}</h2>` has no editable text of its own — find the
    // `title="..."` literal at the (only) call site and rewrite it.
    const src = [
      "const Card = ({ title }: { title: string }) => (",
      "  <h2>{title}</h2>",
      ");",
      "export default [() => (",
      '  <Card title="Hello" />',
      ")];",
      "",
    ].join("\n");
    const r = applyEdit(src, 2, 2, [
      { kind: "set-text", prevText: "Hello", value: "Goodbye" },
    ]);
    if (!r.ok) {
      throw new Error(`expected ok, got ${r.error}`);
    }
    expect(r.source).toContain('<Card title="Goodbye" />');
    expect(r.source).toContain("<h2>{title}</h2>");
  });

  it("disambiguates among sibling call sites of a reused prop component", () => {
    const src = [
      "const Card = ({ title }: { title: string }) => (",
      "  <h2>{title}</h2>",
      ");",
      "export default [() => (",
      "  <section>",
      '    <Card title="First" />',
      '    <Card title="Second" />',
      "  </section>",
      ")];",
      "",
    ].join("\n");
    const r = applyEdit(src, 2, 2, [
      { kind: "set-text", prevText: "Second", value: "Edited" },
    ]);
    if (!r.ok) {
      throw new Error(`expected ok, got ${r.error}`);
    }
    expect(r.source).toContain('<Card title="First" />');
    expect(r.source).toContain('<Card title="Edited" />');
  });

  it("escapes a prop value that needs an expression container", () => {
    const src = [
      "const Card = ({ label }: { label: string }) => (",
      "  <h2>{label}</h2>",
      ");",
      "export default [() => (",
      '  <Card label="plain" />',
      ")];",
      "",
    ].join("\n");
    const r = applyEdit(src, 2, 2, [
      { kind: "set-text", prevText: "plain", value: 'with "quotes"' },
    ]);
    if (!r.ok) {
      throw new Error(`expected ok, got ${r.error}`);
    }
    expect(r.source).toContain(`<Card label={'with "quotes"'} />`);
  });

  it("bails on a prop pass-through when the prop is not destructured", () => {
    const src = [
      "const Card = (props) => (",
      "  <h2>{title}</h2>",
      ");",
      "export default [() => (",
      '  <Card title="Hello" />',
      ")];",
      "",
    ].join("\n");
    const r = applyEdit(src, 2, 2, [
      { kind: "set-text", prevText: "Hello", value: "X" },
    ]);
    expect(r.ok).toBe(false);
    if (r.ok) {
      throw new Error("expected failure");
    }
    expect(r.error).toMatch("no editable text");
  });

  it("routes a `.map()` MemberExpression child to the matching array entry", () => {
    const src = [
      "const surfaces = [",
      "  { tag: 'CLI', label: 'Terminal' },",
      "  { tag: 'IDE', label: 'VS Code' },",
      "];",
      "export default [() => (",
      "  <>",
      "    {surfaces.map((s) => (",
      "      <div key={s.tag}>{s.label}</div>",
      "    ))}",
      "  </>",
      ")];",
      "",
    ].join("\n");
    const r = applyEdit(src, 8, 6, [
      { kind: "set-text", prevText: "Terminal", value: "Shell" },
    ]);
    if (!r.ok) {
      throw new Error(`expected ok, got ${r.error}`);
    }
    expect(r.source).toContain("label: 'Shell'");
    expect(r.source).toContain("label: 'VS Code'");
  });

  it("routes a `.map()` Identifier child (destructured) to the matching array entry", () => {
    const src = [
      "const items = [",
      "  { name: 'First' },",
      "  { name: 'Second' },",
      "];",
      "export default [() => (",
      "  <>",
      "    {items.map(({ name }) => (",
      "      <span key={name}>{name}</span>",
      "    ))}",
      "  </>",
      ")];",
      "",
    ].join("\n");
    const r = applyEdit(src, 8, 6, [
      { kind: "set-text", prevText: "Second", value: "Edited" },
    ]);
    if (!r.ok) {
      throw new Error(`expected ok, got ${r.error}`);
    }
    expect(r.source).toContain("name: 'First'");
    expect(r.source).toContain("name: 'Edited'");
  });

  it("handles an inline array literal in a `.map()` callee", () => {
    const src = [
      "export default [() => (",
      "  <>",
      "    {[{ word: 'a' }, { word: 'b' }].map((x) => (",
      "      <em key={x.word}>{x.word}</em>",
      "    ))}",
      "  </>",
      ")];",
      "",
    ].join("\n");
    const r = applyEdit(src, 4, 6, [
      { kind: "set-text", prevText: "a", value: "A!" },
    ]);
    if (!r.ok) {
      throw new Error(`expected ok, got ${r.error}`);
    }
    expect(r.source).toContain("word: 'A!'");
    expect(r.source).toContain("word: 'b'");
  });

  it("bails on a `.map()` child when the prop is not a literal", () => {
    const src = [
      'const greet = "hi";',
      "const items = [{ name: greet }];",
      "export default [() => (",
      "  <>",
      "    {items.map((x) => (",
      "      <span>{x.name}</span>",
      "    ))}",
      "  </>",
      ")];",
      "",
    ].join("\n");
    const r = applyEdit(src, 6, 6, [
      { kind: "set-text", prevText: "hi", value: "X" },
    ]);
    expect(r.ok).toBe(false);
    if (r.ok) {
      throw new Error("expected failure");
    }
    expect(r.error).toMatch("no editable text");
  });

  it("bails on a prop pass-through when the call site uses a non-literal value", () => {
    const src = [
      'const heading = "Hello";',
      "const Card = ({ title }: { title: string }) => (",
      "  <h2>{title}</h2>",
      ");",
      "export default [() => (",
      "  <Card title={heading} />",
      ")];",
      "",
    ].join("\n");
    const r = applyEdit(src, 3, 2, [
      { kind: "set-text", prevText: "Hello", value: "X" },
    ]);
    expect(r.ok).toBe(false);
    if (r.ok) {
      throw new Error("expected failure");
    }
    expect(r.error).toMatch("no editable text");
  });
});

describe("applyEdit / combined ops", () => {
  it("applies style and text ops in one pass", () => {
    const src = ["export default [() => (", "<h1>Hello</h1>", ")];", ""].join(
      "\n"
    );
    const r = applyEdit(src, 2, 0, [
      { key: "fontWeight", kind: "set-style", value: "700" },
      { kind: "set-text", value: "Bold!" },
    ]);
    if (!r.ok) {
      throw new Error(`expected ok, got ${r.error}`);
    }
    expect(r.source).toContain("<h1 style={{ fontWeight: '700' }}>Bold!</h1>");
  });

  it("returns an unchanged source when ops are empty", () => {
    const src = "<h1>Hi</h1>";
    const r = applyEdit(src, 1, 0, []);
    if (!r.ok) {
      throw new Error("expected ok");
    }
    expect(r.source).toBe(src);
  });
});

describe("applyEdit / set-prop", () => {
  const setProp = (
    src: string,
    prop: string,
    value: string,
    prevText?: string
  ) => applyEdit(src, 1, 0, [{ kind: "set-prop", prevText, prop, value }]);
  const rewritten = (
    src: string,
    prop: string,
    value: string,
    prevText?: string
  ) => {
    const r = setProp(src, prop, value, prevText);
    if (!r.ok) {
      throw new Error(`expected ok, got ${r.error}`);
    }
    return r.source;
  };
  const failure = (
    src: string,
    prop: string,
    value: string,
    prevText?: string
  ) => {
    const r = setProp(src, prop, value, prevText);
    if (r.ok) {
      throw new Error(`expected failure, got ${r.source}`);
    }
    return r.error;
  };

  it("rewrites a string attribute in every literal form", () => {
    expect(rewritten('<Title title="Old" />', "title", "New")).toBe(
      '<Title title="New" />'
    );
    expect(rewritten('<Title title={"Old"} />', "title", "New")).toBe(
      '<Title title="New" />'
    );
    expect(rewritten("<Title title={`Old`} />", "title", "New")).toBe(
      '<Title title="New" />'
    );
  });

  it("wraps values that a quoted attribute cannot hold", () => {
    expect(rewritten('<Title title="Old" />', "title", 'Say "hi"')).toBe(
      `<Title title={'Say "hi"'} />`
    );
  });

  it("adds the attribute when it is missing", () => {
    expect(rewritten('<Title subtitle="Sub" />', "title", "New")).toBe(
      '<Title subtitle="Sub" title="New" />'
    );
    expect(rewritten("<Title />", "title", "New")).toBe(
      '<Title title="New" />'
    );
  });

  it("rewrites one element of an array attribute", () => {
    expect(
      rewritten('<Bullets items={["a", `b`, "c"]} />', "items.1", "B's")
    ).toBe(`<Bullets items={["a", 'B\\'s', "c"]} />`);
  });

  it("checks prevText against the current value", () => {
    expect(rewritten('<Title title="Old" />', "title", "New", "Old")).toBe(
      '<Title title="New" />'
    );
    expect(failure('<Title title="Old" />', "title", "New", "Older")).toMatch(
      "no text candidate"
    );
    expect(failure('<Bullets items={["a"]} />', "items.0", "x", "b")).toMatch(
      "no text candidate"
    );
  });

  it("refuses attributes that are not string literals", () => {
    expect(failure("<Title title={heading} />", "title", "x")).toBe(
      'prop "title" isn\'t a string literal'
    );
    expect(failure("<Title title={<b>x</b>} />", "title", "x")).toMatch(
      "isn't a string literal"
    );
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the source under test holds a template literal.
    expect(failure("<Title title={`a${b}`} />", "title", "x")).toMatch(
      "isn't a string literal"
    );
    expect(failure("<Title hidden />", "hidden", "x")).toMatch(
      "isn't a string literal"
    );
  });

  it("refuses array elements it cannot rewrite", () => {
    expect(failure("<Bullets items={list} />", "items.0", "x")).toBe(
      'prop "items" isn\'t an array literal'
    );
    expect(failure('<Bullets items={["a"]} />', "items.3", "x")).toBe(
      'prop "items" has no element 3'
    );
    expect(failure('<Bullets items={["a", b]} />', "items.1", "x")).toBe(
      'prop "items.1" isn\'t a string literal'
    );
    expect(
      failure('<Bullets items={[...more, "a"]} />', "items.1", "x")
    ).toMatch("spreads");
    expect(failure("<Bullets />", "items.0", "x")).toBe(
      'prop "items" is missing, so it has no element 0'
    );
  });

  it("refuses the same prop twice in one edit", () => {
    const r = applyEdit('<Title title="Old" />', 1, 0, [
      { kind: "set-prop", prop: "title", value: "A" },
      { kind: "set-prop", prop: "title", value: "B" },
    ]);
    if (r.ok) {
      throw new Error("expected failure");
    }
    expect(r.error).toMatch("set twice");
  });

  it("combines with style edits on the same element", () => {
    const r = applyEdit('<Title title="Old" />', 1, 0, [
      { key: "color", kind: "set-style", value: "red" },
      { kind: "set-prop", prop: "title", value: "New" },
    ]);
    if (!r.ok) {
      throw new Error(`expected ok, got ${r.error}`);
    }
    expect(r.source).toBe(`<Title title="New" style={{ color: 'red' }} />`);
  });
});
