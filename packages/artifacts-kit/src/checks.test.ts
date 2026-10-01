import { describe, expect, it } from "vitest";

import {
  compiles,
  importSpecifiers,
  importsAllowed,
  matches,
  sizeLimit,
} from "./checks";

describe("sizeLimit", () => {
  it("allows the limit and refuses one character over it", () => {
    const check = sizeLimit({ chars: 3 });
    expect(check.run("abc")).toEqual([]);
    expect(check.run("abcd")).toEqual(["content is longer than 3 characters"]);
  });

  it("measures structured content as JSON, or as the kind says", () => {
    // `{"a":"bcd"}` is 11 characters.
    expect(sizeLimit({ chars: 11 }).run({ a: "bcd" })).toEqual([]);
    expect(sizeLimit({ chars: 11 }).run({ a: "bcde" })).toHaveLength(1);
    const files = sizeLimit<{ files: Record<string, string> }>({
      chars: 4,
      of: (content) => Object.values(content.files).join(""),
    });
    expect(files.run({ files: { "a.ts": "12", "b.ts": "34" } })).toEqual([]);
    expect(files.run({ files: { "a.ts": "123", "b.ts": "45" } })).toHaveLength(
      1
    );
  });
});

const SVG_START = /^<svg/;

describe("matches", () => {
  it("reports its message when the pattern doesn't match", () => {
    const check = matches(SVG_START, "not an svg");
    expect(check.run("<svg></svg>")).toEqual([]);
    expect(check.run("<p>")).toEqual(["not an svg"]);
  });
});

describe("importSpecifiers", () => {
  it("finds every form of import, in order, once each", () => {
    const source = [
      'import React, { useState } from "react";',
      "import * as Dom from 'react-dom';",
      'import "./styles.css";',
      'export { thing } from "lodash";',
      'export * from "recharts";',
      "import type { Props } from './types';",
      'const lazy = import("lucide-react");',
      'const old = require("react");',
      "import {",
      "  a,",
      "  b,",
      '} from "multi-line";',
    ].join("\n");
    expect(importSpecifiers(source)).toEqual([
      "react",
      "react-dom",
      "./styles.css",
      "lodash",
      "recharts",
      "./types",
      "lucide-react",
      "multi-line",
    ]);
  });

  it("finds nothing in code that imports nothing", () => {
    expect(
      importSpecifiers("export default function App() { return null; }")
    ).toEqual([]);
  });
});

describe("importsAllowed", () => {
  const check = importsAllowed(["react", "react-dom"]);

  it("allows the listed modules", () => {
    expect(
      check.run('import { useState } from "react";\nexport default 1;')
    ).toEqual([]);
  });

  it("names each module that isn't listed, and what is", () => {
    expect(
      check.run('import { Sun } from "lucide-react";\nimport x from "react";')
    ).toEqual([
      'imports "lucide-react", which isn\'t available here. It may import: react, react-dom',
    ]);
    expect(importsAllowed([]).run('import "x";')).toEqual([
      'imports "x", which isn\'t available here. It may import: nothing',
    ]);
  });
});

describe("compiles", () => {
  it("passes what the compiler accepts and reports what it says", () => {
    const check = compiles((source) =>
      source.includes("<<") ? "Unexpected token (1:2)" : null
    );
    expect(check.run("export default 1")).toEqual([]);
    expect(check.run("a << b")).toEqual([
      "doesn't compile: Unexpected token (1:2)",
    ]);
  });
});
