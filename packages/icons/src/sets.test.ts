import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  materialSymbols,
  materialVariants,
  pickGlyphs,
  vendoredFile,
  vendoredWeightSchema,
} from "../scripts/material";
import { exportedIconNames } from "../scripts/registry";
import { materialVendorDir } from "../scripts/sets";
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
// `weight: 100`. A failure here means a symbol was mapped without rerunning
// `icons:vendor`.
describe("vendored Material symbols", () => {
  const symbols = materialSymbols(
    readFileSync(join(import.meta.dirname, "sets", "material.ts"), "utf8")
  );

  it("cover all 42 variants", () => {
    expect(materialVariants).toHaveLength(42);
  });

  it.each(materialVariants)(
    "cover every mapped symbol in $style, $weight, fill $fill",
    (variant) => {
      const data = vendoredWeightSchema.parse(
        JSON.parse(
          readFileSync(
            join(materialVendorDir, vendoredFile(variant.weight)),
            "utf8"
          )
        )
      );
      const picked = pickGlyphs(data, variant, symbols);
      expect(picked.ok ? [] : picked.error).toEqual([]);
    }
  );
});

describe("the vocabulary", () => {
  it("has no duplicates and uses lucide's Icon suffix", () => {
    expect(new Set(iconNames).size).toBe(iconNames.length);
    for (const name of iconNames) {
      expect(name).toMatch(lucideName);
    }
  });
});
