import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

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

describe("phosphor.ts", () => {
  it("only maps names in the vocabulary", () => {
    const vocabulary = new Set<string>(iconNames);
    expect(
      namesIn("phosphor.ts").filter((name) => !vocabulary.has(name))
    ).toEqual([]);
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
