import { describe, expect, it } from "vitest";

import {
  clampSplit,
  LIST_BESIDE_FROM,
  MIN_PANE_HEIGHT,
  maximisedAfter,
  paneLayout,
  parseSplit,
  SPLIT_BELOW,
  SPLIT_DEFAULT,
  splitBounds,
  viewOf,
} from "./split";

// The browser over the files (097): the divider's share, which halves show
// at a width, and which half a pick asks for when they take turns.

const wide = {
  filesSelected: true,
  hasPreview: true,
  maximised: null,
  view: "main",
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
      list: true,
      listAlone: false,
      main: true,
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
    // No browser to take turns with, but the list and the file still do.
    expect(layout.turns).toBe(false);
    expect(layout.list).toBe(false);
    expect(layout.main).toBe(true);
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
    const list = paneLayout({ ...narrow, view: "list" });
    expect([list.browser, list.files, list.list, list.main]).toEqual([
      false,
      true,
      true,
      false,
    ]);
    const main = paneLayout({ ...narrow, view: "main" });
    expect([main.browser, main.list, main.main]).toEqual([false, false, true]);
  });

  it("stacks between SPLIT_BELOW and LIST_BESIDE_FROM, the list and the file taking turns below", () => {
    const between = { ...wide, width: (SPLIT_BELOW + LIST_BESIDE_FROM) / 2 };
    // The browser's turn leaves the open file below in view…
    const browser = paneLayout({ ...between, view: "browser" });
    expect([browser.browser, browser.list, browser.main]).toEqual([
      true,
      false,
      true,
    ]);
    // …or the list, with nothing open.
    const nothing = paneLayout({
      ...between,
      filesSelected: false,
      view: "browser",
    });
    expect([nothing.list, nothing.main]).toEqual([true, false]);
  });

  it("lays out as wide before the width is measured", () => {
    expect(paneLayout({ ...wide, view: "list", width: 0 })).toEqual(
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
    ).toBe("main");
    expect(viewOf({ kind: "file", path: "README.md" }, {})).toBe("main");
    expect(viewOf({ kind: "artifact" }, {})).toBe("main");
    expect(viewOf(null, {})).toBe("list");
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
    expect(maximisedAfter("browser", { kind: "artifact" })).toBeNull();
  });

  it("leaves it when the pick shows in the half that's maximised", () => {
    expect(maximisedAfter("browser", { kind: "preview" })).toBe("browser");
    expect(maximisedAfter("files", { kind: "file", path: "a.ts" })).toBe(
      "files"
    );
    expect(maximisedAfter("files", null)).toBe("files");
    expect(maximisedAfter(null, { kind: "preview" })).toBeNull();
  });
});
