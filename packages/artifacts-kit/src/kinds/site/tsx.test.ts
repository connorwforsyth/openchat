import { transform } from "sucrase";
import { describe, expect, it } from "vitest";

import { DESIGN_GUIDES } from "./design/generated";
import { SITE_TSX_MODULES, tsxImports, tsxPageProblems } from "./tsx";

// TSX pages' imports (163), and the site-ui guide's examples, which must be
// pages that pass the checks and compile as the runtime compiles them.
// apps/artifacts' runtime tests render them.

const REQUIRES_SITE_UI = /require\(['"]@workspace\/site-ui['"]\)/;
const TSX_BLOCK = /```tsx\n([\s\S]*?)```/g;
const examples = [...DESIGN_GUIDES["site-ui"].matchAll(TSX_BLOCK)].map(
  (match) => match[1] ?? ""
);

describe("a TSX page's imports", () => {
  it("are read with what each binds, leaving types out", () => {
    expect(
      tsxImports(
        [
          'import React, { useState as useS } from "react";',
          'import { Hero, type HeroProps, FeatureGrid as Grid } from "@workspace/site-ui";',
          'import type { Plan } from "@workspace/site-ui";',
          'import * as UI from "@workspace/site-ui";',
        ].join("\n")
      )
    ).toEqual([
      { names: ["useState"], specifier: "react", whole: true },
      {
        names: ["Hero", "FeatureGrid"],
        specifier: "@workspace/site-ui",
        whole: false,
      },
      { names: [], specifier: "@workspace/site-ui", whole: true },
    ]);
  });

  it("may come only from React and site-ui", () => {
    expect(SITE_TSX_MODULES).toEqual([
      "react",
      "react/jsx-runtime",
      "@workspace/site-ui",
    ]);
    expect(
      tsxPageProblems(
        "a.tsx",
        'import { Hero } from "@workspace/site-ui";\nexport default () => <Hero title="x" />;'
      )
    ).toEqual([]);
  });
});

describe("the site-ui design guide's examples", () => {
  it("are there", () => {
    expect(examples.length).toBeGreaterThanOrEqual(2);
  });

  it.each(examples.map((source, index) => [index, source] as const))(
    "example %i passes the page checks and compiles",
    (_index, source) => {
      expect(tsxPageProblems("index.tsx", source)).toEqual([]);
      const { code } = transform(source, {
        jsxRuntime: "automatic",
        production: true,
        transforms: ["typescript", "jsx", "imports"],
      });
      expect(code).toMatch(REQUIRES_SITE_UI);
    }
  );
});
