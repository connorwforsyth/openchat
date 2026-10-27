import { describe, expect, it } from "vitest";

import {
  COLUMNS_BELOW,
  clampListWidth,
  clampSplit,
  INSPECTOR_MIN_WIDTH,
  LIST_WIDTH_DEFAULT,
  LIST_WIDTH_MIN,
  MIN_PANE_HEIGHT,
  maximisedAfter,
  maximisedForHalf,
  type PanelSlots,
  paneLayout,
  parseListWidth,
  parseSplit,
  SPLIT_BELOW,
  SPLIT_DEFAULT,
  slotsAfter,
  splitBounds,
  viewForHalf,
  viewOf,
} from "./split";

// The browser over the files (097): the divider's share, which halves show
// at a width, and which half a pick asks for when they take turns.

const wide = {
  hasPreview: true,
  maximised: null,
  view: "files",
  width: 900,
} as const;

describe("the divider's share", () => {
  it("keeps both halves at least MIN_PANE_HEIGHT tall", () => {
    expect(splitBounds(600)).toEqual({
      max: 1 - MIN_PANE_HEIGHT / 600,
      min: MIN_PANE_HEIGHT / 600,
    });
    expect(clampSplit(0.95, 600)).toBe(0.8);
    expect(clampSplit(0.05, 600)).toBe(0.2);
    expect(clampSplit(0.6, 600)).toBe(0.6);
  });

  it("leaves a share alone before the height is known, or when there's no room", () => {
    expect(splitBounds(0)).toEqual({ max: 1, min: 0 });
    expect(splitBounds(2 * MIN_PANE_HEIGHT)).toEqual({ max: 1, min: 0 });
    expect(clampSplit(0.9)).toBe(0.9);
    expect(clampSplit(Number.NaN, 600)).toBe(SPLIT_DEFAULT);
    expect(clampSplit(0.123_456)).toBe(0.123);
  });

  it("reads a stored share, and anything else as the default", () => {
    expect(parseSplit("0.3")).toBe(0.3);
    for (const raw of [null, "", " ", "abc", "0", "1", "-2", "7"]) {
      expect(parseSplit(raw)).toBe(SPLIT_DEFAULT);
    }
  });
});

describe("paneLayout", () => {
  it("stacks the browser over the files, each with a Maximise", () => {
    expect(paneLayout(wide)).toEqual({
      browser: true,
      divider: true,
      files: true,
      maximisable: true,
      turns: false,
    });
  });

  it("gives the files the whole height while there's nothing to preview", () => {
    const layout = paneLayout({ ...wide, hasPreview: false, width: 300 });
    expect(layout.browser).toBe(false);
    expect(layout.divider).toBe(false);
    expect(layout.files).toBe(true);
    expect(layout.maximisable).toBe(false);
    expect(layout.turns).toBe(false);
  });

  it("hides the other half while one is maximised", () => {
    const browser = paneLayout({ ...wide, maximised: "browser" });
    expect([browser.browser, browser.files, browser.divider]).toEqual([
      true,
      false,
      false,
    ]);
    const files = paneLayout({ ...wide, maximised: "files" });
    expect([files.browser, files.files, files.divider]).toEqual([
      false,
      true,
      false,
    ]);
  });

  it("takes turns under SPLIT_BELOW, ignoring a maximised half", () => {
    const narrow = {
      ...wide,
      maximised: "files",
      width: SPLIT_BELOW - 1,
    } as const;
    const browser = paneLayout({ ...narrow, view: "browser" });
    expect(browser.turns).toBe(true);
    expect(browser.maximisable).toBe(false);
    expect([browser.browser, browser.files]).toEqual([true, false]);
    const files = paneLayout({ ...narrow, view: "files" });
    expect([files.browser, files.files]).toEqual([false, true]);
  });

  it("lays out as wide before the width is measured", () => {
    expect(paneLayout({ ...wide, view: "browser", width: 0 })).toEqual(
      paneLayout(wide)
    );
  });
});

describe("viewOf", () => {
  it("asks for the browser for the Preview and an HTML file, unless it's switched to code", () => {
    expect(viewOf({ kind: "preview" }, {})).toBe("browser");
    expect(viewOf({ kind: "file", path: "site/index.html" }, {})).toBe(
      "browser"
    );
    expect(
      viewOf(
        { kind: "file", path: "site/index.html" },
        { "site/index.html": "code" }
      )
    ).toBe("files");
    expect(viewOf({ kind: "file", path: "README.md" }, {})).toBe("files");
    // An artifact is the top half's (night 2).
    expect(viewOf({ kind: "artifact" }, {})).toBe("browser");
    expect(viewOf(null, {})).toBe("files");
  });
});

describe("maximisedAfter", () => {
  it("brings back the half a pick shows in", () => {
    expect(maximisedAfter("files", { kind: "preview" })).toBeNull();
    expect(
      maximisedAfter("files", { kind: "file", path: "index.html" })
    ).toBeNull();
    expect(
      maximisedAfter("browser", { kind: "file", path: "a.ts" })
    ).toBeNull();
    expect(maximisedAfter("files", { kind: "artifact" })).toBeNull();
  });

  it("leaves it when the pick shows in the half that's maximised", () => {
    expect(maximisedAfter("browser", { kind: "preview" })).toBe("browser");
    expect(maximisedAfter("files", { kind: "file", path: "a.ts" })).toBe(
      "files"
    );
    expect(maximisedAfter("files", null)).toBe("files");
    expect(maximisedAfter(null, { kind: "preview" })).toBeNull();
    expect(maximisedAfter("browser", { kind: "artifact" })).toBe("browser");
  });
});

// 137: the header's Browser and Files each ask for their half.
describe("a header press", () => {
  it("gives the browser the whole height for Browser", () => {
    expect(maximisedForHalf(null, "browser")).toBe("browser");
    expect(maximisedForHalf("files", "browser")).toBe("browser");
  });

  it("brings the files back from a maximised browser for Files", () => {
    expect(maximisedForHalf("browser", "files")).toBeNull();
    expect(maximisedForHalf(null, "files")).toBeNull();
    expect(maximisedForHalf("files", "files")).toBe("files");
  });

  it("shows the browser even with nothing to preview yet", () => {
    const layout = paneLayout({
      ...wide,
      hasPreview: true,
      maximised: maximisedForHalf(null, "browser"),
    });
    expect(layout).toMatchObject({
      browser: true,
      divider: false,
      files: false,
    });
  });

  it("takes the half's turn on a narrow panel", () => {
    expect(viewForHalf("browser")).toBe("browser");
    expect(viewForHalf("files")).toBe("files");
  });
});

// Night 2: an artifact above and a file below are open together.
describe("each half's slot", () => {
  const empty: PanelSlots = { file: null, preview: null };
  const file = { kind: "file", path: "notes.txt" } as const;
  const artifact = { kind: "artifact" } as const;

  it("fills the half a pick belongs to and leaves the other", () => {
    const withFile = slotsAfter(empty, file);
    expect(withFile).toEqual({ file, preview: null });
    const both = slotsAfter(withFile, artifact);
    expect(both).toEqual({ file, preview: artifact });
    expect(slotsAfter(both, { kind: "preview" })).toEqual({
      file,
      preview: { kind: "preview" },
    });
  });

  it("closes the file, not the preview, when nothing is selected", () => {
    expect(slotsAfter({ file, preview: artifact }, null)).toEqual({
      file: null,
      preview: artifact,
    });
    expect(slotsAfter(empty, null)).toBe(empty);
  });
});

describe("the file list's width", () => {
  it("keeps the open file at least INSPECTOR_MIN_WIDTH beside it", () => {
    expect(clampListWidth(500, 600)).toBe(600 - INSPECTOR_MIN_WIDTH);
    expect(clampListWidth(20, 600)).toBe(LIST_WIDTH_MIN);
    // Before a measure, only the list's own limits apply.
    expect(clampListWidth(300)).toBe(300);
  });

  it("reads a stored width, and the default for anything else", () => {
    expect(parseListWidth("240")).toBe(240);
    expect(parseListWidth(null)).toBe(LIST_WIDTH_DEFAULT);
    expect(parseListWidth("wide")).toBe(LIST_WIDTH_DEFAULT);
  });

  it("takes turns with the open file below room for both", () => {
    expect(COLUMNS_BELOW).toBeGreaterThan(LIST_WIDTH_MIN + INSPECTOR_MIN_WIDTH);
  });
});
