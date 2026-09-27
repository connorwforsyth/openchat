import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  artifactElement,
  compileArtifact,
  evaluateArtifact,
  loadReactArtifact,
} from "./react-artifact";

const counter = `import { useState } from "react";

type Props = { start?: number };

export default function Counter({ start = 2 }: Props) {
  const [count] = useState(start);
  return (
    <main className="counter">
      <p>Count {count}</p>
      <Label text="hi" />
      <>
        <span>fragment child</span>
      </>
    </main>
  );
}

function Label({ text }: { text: string }) {
  return <em>{text}</em>;
}
`;

const POSITION = /\(1:\d+\)/;

const html = (source: string, fileName = "Counter.tsx") => {
  const element = loadReactArtifact(source, fileName);
  if (!element.ok) {
    throw new Error(`expected a component, got ${element.error.kind}`);
  }
  return renderToStaticMarkup(element.value);
};

describe("compileArtifact", () => {
  it("strips types and compiles JSX and imports to CommonJS", () => {
    const compiled = compileArtifact(counter, "Counter.tsx");
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) {
      return;
    }
    expect(compiled.value.code).not.toContain("type Props");
    expect(compiled.value.code).toContain("exports.default");
    expect(compiled.value.imports).toEqual(["react/jsx-dev-runtime", "react"]);
  });

  it("records each element's source line for the data-src stamp", () => {
    const compiled = compileArtifact(counter, "Counter.tsx");
    expect(compiled.ok && compiled.value.code).toContain("lineNumber: 8");
  });

  it("reports a syntax error with its position", () => {
    const compiled = compileArtifact(
      "export default () => <div>",
      "Broken.tsx"
    );
    expect(compiled).toEqual({
      error: { kind: "syntax", message: expect.stringMatching(POSITION) },
      ok: false,
    });
  });
});

describe("rendering with data-src stamps", () => {
  it("stamps DOM elements with file:line and runs hooks", () => {
    const markup = html(counter);
    expect(markup).toContain('<main class="counter" data-src="Counter.tsx:8">');
    expect(markup).toContain('<p data-src="Counter.tsx:9">Count 2</p>');
    // Inside a component defined in the same file.
    expect(markup).toContain('<em data-src="Counter.tsx:19">hi</em>');
    expect(markup).toContain('<span data-src="Counter.tsx:12">');
  });

  it("uses the file name it's given", () => {
    expect(html("export default () => <b>x</b>;", "Chart.tsx")).toBe(
      '<b data-src="Chart.tsx:1">x</b>'
    );
  });

  it("renders a default-exported element as well as a component", () => {
    expect(html("export default <i>hello</i>;")).toBe(
      '<i data-src="Counter.tsx:1">hello</i>'
    );
  });

  it("supports React's default and namespace imports", () => {
    const source = `import React, * as All from "react";
export default function App() {
  const [n] = React.useState(1);
  const [m] = All.useState(2);
  return <span>{n + m}</span>;
}`;
    expect(html(source)).toBe('<span data-src="Counter.tsx:5">3</span>');
  });
});

describe("errors", () => {
  it("refuses modules outside the allowlist, before running anything", () => {
    const compiled = compileArtifact(
      'import confetti from "canvas-confetti";\nexport default () => { confetti(); return null; };',
      "App.tsx"
    );
    if (!compiled.ok) {
      throw new Error("expected it to compile");
    }
    expect(evaluateArtifact(compiled.value)).toEqual({
      error: { kind: "import", message: "canvas-confetti" },
      ok: false,
    });
  });

  it("doesn't resolve Object prototype keys as modules", () => {
    const compiled = compileArtifact(
      'import x from "constructor";\nexport default () => x;',
      "App.tsx"
    );
    expect(compiled.ok && evaluateArtifact(compiled.value)).toEqual({
      error: { kind: "import", message: "constructor" },
      ok: false,
    });
  });

  it("reports code that throws while the module runs", () => {
    expect(loadReactArtifact('throw new Error("boom");', "App.tsx")).toEqual({
      error: { kind: "render", message: "boom" },
      ok: false,
    });
  });

  it("asks for a default export when there's nothing to render", () => {
    expect(
      loadReactArtifact("export const App = () => <p />;", "App.tsx")
    ).toEqual({ error: { kind: "export", message: "" }, ok: false });
    expect(artifactElement({ default: 42 })).toEqual({
      error: { kind: "export", message: "" },
      ok: false,
    });
  });
});
