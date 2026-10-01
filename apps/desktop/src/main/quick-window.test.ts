import { describe, expect, it } from "vitest";

import { placeQuickWindow, QUICK_WINDOW, quickHeight } from "./quick-window";

const laptop = { height: 875, width: 1512, x: 0, y: 25 };
const monitor = { height: 1415, width: 2560, x: 1512, y: -400 };

describe("placeQuickWindow", () => {
  it("centres the window across the display, its tallest centred down it", () => {
    expect(placeQuickWindow(laptop)).toEqual({
      height: QUICK_WINDOW.maxHeight,
      width: QUICK_WINDOW.width,
      x: (1512 - QUICK_WINDOW.width) / 2,
      y: Math.round(25 + (875 - QUICK_WINDOW.maxHeight) / 2),
    });
  });

  it("uses the display it's given, wherever it sits", () => {
    const spot = placeQuickWindow(monitor);
    expect(spot.x).toBe(1512 + (2560 - QUICK_WINDOW.width) / 2);
    expect(spot.y).toBe(Math.round(-400 + (1415 - QUICK_WINDOW.maxHeight) / 2));
  });

  it("fits a small display, leaving a margin", () => {
    const small = { height: 400, width: 600, x: 0, y: 0 };
    expect(placeQuickWindow(small)).toEqual({
      height: 368,
      width: 568,
      x: 16,
      y: 16,
    });
  });

  it("lands on whole pixels", () => {
    const odd = { height: 901, width: 1441, x: 0, y: 0 };
    const spot = placeQuickWindow(odd);
    expect(Number.isInteger(spot.x)).toBe(true);
    expect(Number.isInteger(spot.y)).toBe(true);
  });
});

describe("quickHeight", () => {
  it("follows the page between the composer and the cap", () => {
    expect(quickHeight(240, laptop)).toBe(240);
    expect(quickHeight(40, laptop)).toBe(QUICK_WINDOW.minHeight);
    expect(quickHeight(2000, laptop)).toBe(QUICK_WINDOW.maxHeight);
  });

  it("never outgrows a short display", () => {
    expect(quickHeight(2000, { height: 400 })).toBe(368);
  });

  it("rounds to whole pixels", () => {
    expect(quickHeight(240.6, laptop)).toBe(241);
  });
});
