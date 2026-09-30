import { describe, expect, it } from "vitest";

import {
  committedMatch,
  directoryTailStart,
  highlightRuns,
  type MiddleText,
  nameTailStart,
  resultLabel,
  searchFiles,
  searchTerms,
  sliceRuns,
  stepMatch,
  type TextRun,
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

/** Runs as a string, hits in [brackets]. */
const marked = (runs: readonly TextRun[]) =>
  runs.map((run) => (run.hit ? `[${run.text}]` : run.text)).join("");
const middle = ({ head, tail }: MiddleText) =>
  `${marked(head)} | ${marked(tail)}`;

describe("highlightRuns", () => {
  it("marks every term, ignoring case, and merges overlapping and touching hits", () => {
    expect(marked(highlightRuns("ReadMe-readme.md", ["readme"]))).toBe(
      "[ReadMe]-[readme].md"
    );
    expect(marked(highlightRuns("button.tsx", ["butt", "ton", "tsx"]))).toBe(
      "[button].[tsx]"
    );
    expect(marked(highlightRuns("aaa", ["aa"]))).toBe("[aaa]");
  });

  it("leaves text without hits whole, and has no runs for no text", () => {
    expect(highlightRuns("notes.md", ["zzz"])).toEqual([
      { hit: false, text: "notes.md" },
    ]);
    expect(highlightRuns("notes.md", [])).toEqual([
      { hit: false, text: "notes.md" },
    ]);
    expect(highlightRuns("", ["a"])).toEqual([]);
  });

  it("doesn't mark text whose length changes when lower-cased", () => {
    expect(highlightRuns("İndex.ts", ["index"])).toEqual([
      { hit: false, text: "İndex.ts" },
    ]);
  });
});

describe("sliceRuns", () => {
  const runs = highlightRuns("src/app.ts", ["c/a"]);
  it("cuts runs at any offset, keeping their marks", () => {
    expect(marked(sliceRuns(runs, 0, 4))).toBe("sr[c/]");
    expect(marked(sliceRuns(runs, 4, 10))).toBe("[a]pp.ts");
    expect(sliceRuns(runs, 4, 4)).toEqual([]);
  });
});

describe("nameTailStart (middle truncation)", () => {
  const tail = (name: string) => name.slice(nameTailStart(name));

  it("keeps the extension and the last whole words, so similar names stay apart", () => {
    expect(tail("very-long-component-file-name-number-7.tsx")).toBe(
      "number-7.tsx"
    );
    expect(tail("ArtifactPreviewPanel.test.tsx")).toBe("Panel.test.tsx");
    expect(tail("workspace_panel_snapshot_2.json")).toBe("snapshot_2.json");
  });

  it("cuts inside a word when no word boundary is near the end", () => {
    expect(tail("abcdefghijklmnopqrstuvwxyz.md")).toBe("uvwxyz.md");
  });

  it("isn't fooled by a long 'extension' or a dotfile", () => {
    expect(tail("release.notes-for-the-next-version")).toBe("version");
    expect(tail(".eslintrc-overrides-for-tests")).toBe("for-tests");
  });

  it("keeps a short name whole in the tail: there's nothing to cut", () => {
    expect(nameTailStart("app.ts")).toBe(0);
    expect(nameTailStart("Makefile")).toBe(0);
  });
});

describe("directoryTailStart", () => {
  it("keeps the last folder", () => {
    const folder = "src/components/forms/";
    expect(folder.slice(directoryTailStart(folder))).toBe("forms/");
    expect(directoryTailStart("src/")).toBe(0);
    expect(directoryTailStart("")).toBe(0);
  });
});

describe("resultLabel", () => {
  const label = (path: string, query: string) => {
    const [match] = searchFiles([path], query);
    if (!match) {
      throw new Error(`no match for ${query}`);
    }
    return resultLabel(match, searchTerms(query));
  };

  it("splits the name and the folder for middle truncation and marks the query in both", () => {
    const { directory, name } = label(
      "src/components/very-long-component-file-name-number-7.tsx",
      "comp 7"
    );
    expect(middle(name)).toBe(
      "very-long-[comp]onent-file-name- | number-[7].tsx"
    );
    expect(middle(directory)).toBe("src/ | [comp]onents/");
  });

  it("marks a term that crosses the last slash on both sides of it", () => {
    const { directory, name } = label("src/app.ts", "c/a");
    expect(middle(directory)).toBe(" | sr[c/]");
    expect(middle(name)).toBe(" | [a]pp.ts");
  });

  it("has no folder at the root", () => {
    const { directory, name } = label("README.md", "read");
    expect(directory).toEqual({ head: [], tail: [] });
    expect(middle(name)).toBe(" | [READ]ME.md");
  });
});
