import { describe, expect, it } from "vitest";

import {
  committedMatch,
  searchFiles,
  searchTerms,
  stepMatch,
} from "./file-search";

const paths = [
  "README.md",
  "docs/",
  "docs/notes.md",
  "src/",
  "src/components/",
  "src/components/button.tsx",
  "src/components/readme-card.tsx",
  "src/math.ts",
  "src/math.test.ts",
];

const found = (query: string) =>
  searchFiles(paths, query).map((match) => match.path);

describe("searchFiles", () => {
  it("finds nothing for an empty or blank query: the tree stays", () => {
    expect(searchTerms("  ")).toEqual([]);
    expect(found("")).toEqual([]);
    expect(found("   ")).toEqual([]);
  });

  it("matches names and paths, ignoring case, and never folders", () => {
    expect(found("MATH")).toEqual(["src/math.ts", "src/math.test.ts"]);
    expect(found("components")).toEqual([
      "src/components/button.tsx",
      "src/components/readme-card.tsx",
    ]);
    expect(found("docs")).toEqual(["docs/notes.md"]);
  });

  it("needs every word, in any order", () => {
    expect(found("test math")).toEqual(["src/math.test.ts"]);
    expect(found("math zzz")).toEqual([]);
  });

  it("ranks a name that starts with the query, then one that contains it, then the path", () => {
    expect(found("readme")).toEqual([
      "README.md",
      "src/components/readme-card.tsx",
    ]);
    expect(found("card")).toEqual(["src/components/readme-card.tsx"]);
    // "src" is only ever in the path: shallower and shorter first.
    expect(found("src").slice(0, 2)).toEqual([
      "src/math.ts",
      "src/math.test.ts",
    ]);
  });

  it("splits each match into its folder and name for the row", () => {
    expect(searchFiles(paths, "button")).toEqual([
      {
        directory: "src/components/",
        name: "button.tsx",
        path: "src/components/button.tsx",
      },
    ]);
    expect(searchFiles(paths, "readme.md")[0]?.directory).toBe("");
  });
});

describe("stepMatch", () => {
  it("↓ starts at the first result and ↑ at the last", () => {
    expect(stepMatch(-1, 3, 1)).toBe(0);
    expect(stepMatch(-1, 3, -1)).toBe(2);
  });

  it("wraps at either end", () => {
    expect(stepMatch(2, 3, 1)).toBe(0);
    expect(stepMatch(0, 3, -1)).toBe(2);
    expect(stepMatch(1, 3, 1)).toBe(2);
  });

  it("has nowhere to go without results, and recovers from a stale index", () => {
    expect(stepMatch(-1, 0, 1)).toBe(-1);
    expect(stepMatch(5, 2, 1)).toBe(0);
  });
});

describe("committedMatch", () => {
  it("opens the active result, else the first, else nothing", () => {
    const matches = searchFiles(paths, "math");
    expect(committedMatch(matches, 1)?.path).toBe("src/math.test.ts");
    expect(committedMatch(matches, -1)?.path).toBe("src/math.ts");
    expect(committedMatch([], -1)).toBeNull();
  });
});
