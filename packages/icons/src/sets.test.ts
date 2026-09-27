import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  materialFile,
  materialPackage,
  materialSymbols,
  svgPathData,
} from "../scripts/material";
import { exportedIconNames } from "../scripts/registry";
import { iconNames } from "./names";

const lucideName = /^[A-Z]\w*Icon$/;

function namesIn(file: string): string[] {
  const source = readFileSync(join(import.meta.dirname, "sets", file), "utf8");
  return exportedIconNames(source);
}

// lucide is every other set's fallback, so a name it lacks would be an
// export that resolves to nothing.
describe.each(["lucide.ts", "lucide.native.ts"])("%s", (file) => {
  it("maps every name in the vocabulary, once", () => {
    const exported = namesIn(file);
    expect([...exported].sort()).toEqual([...iconNames].sort());
  });
});

describe.each(["phosphor.ts", "material.ts"])("%s", (file) => {
  it("only maps names in the vocabulary", () => {
    const vocabulary = new Set<string>(iconNames);
    expect(namesIn(file).filter((name) => !vocabulary.has(name))).toEqual([]);
  });
});

// `icons:select` fails the build on a symbol it can't find, so check every
// variant the config allows up front rather than on someone's first
// `weight: 100`.
describe("material.ts symbols", () => {
  const symbols = materialSymbols(
    readFileSync(join(import.meta.dirname, "sets", "material.ts"), "utf8")
  );
  const requireFrom = createRequire(import.meta.url);
  const weights = [100, 200, 300, 400, 500, 600, 700] as const;
  const variants = weights.flatMap((weight) =>
    (["outlined", "rounded", "sharp"] as const).flatMap((style) =>
      [false, true].map((fill) => ({ fill, style, weight }) as const)
    )
  );

  it.each(variants)("exist in $style, $weight, fill $fill", (variant) => {
    const packageDir = dirname(
      requireFrom.resolve(`${materialPackage(variant.weight)}/package.json`)
    );
    const unusable = symbols.filter((symbol) => {
      const file = join(packageDir, materialFile(variant, symbol));
      return (
        !existsSync(file) ||
        svgPathData(readFileSync(file, "utf8")) === undefined
      );
    });
    expect(unusable).toEqual([]);
  });
});

describe("the vocabulary", () => {
  it("has no duplicates and uses lucide's Icon suffix", () => {
    expect(new Set(iconNames).size).toBe(iconNames.length);
    for (const name of iconNames) {
      expect(name).toMatch(lucideName);
    }
  });
});
