import { describe, expect, it } from "vitest";

import { placeWindow, windowStateOf } from "./window-state";

const laptop = { height: 875, width: 1512, x: 0, y: 25 };
const monitor = { height: 1415, width: 2560, x: 1512, y: -400 };
const defaults = { height: 860, width: 1280 };
const minimum = { height: 480, width: 720 };

describe("placeWindow", () => {
  it("opens a first run at the default size, placed by the OS", () => {
    expect(
      placeWindow({ defaults, minimum, saved: null, workAreas: [laptop] })
    ).toEqual({ bounds: { height: 860, width: 1280 }, maximized: false });
  });

  it("fits the default to a small display", () => {
    const small = { height: 700, width: 1000, x: 0, y: 0 };
    expect(
      placeWindow({ defaults, minimum, saved: null, workAreas: [small] }).bounds
    ).toEqual({ height: 700, width: 1000 });
  });

  it("puts the window back where it was", () => {
    const saved = {
      height: 900,
      maximized: false,
      width: 1400,
      x: 1600,
      y: -300,
    };
    expect(
      placeWindow({ defaults, minimum, saved, workAreas: [laptop, monitor] })
    ).toEqual({
      bounds: { height: 900, width: 1400, x: 1600, y: -300 },
      maximized: false,
    });
  });

  it("keeps the size but not the spot when its display is gone", () => {
    const saved = {
      height: 900,
      maximized: true,
      width: 1400,
      x: 1600,
      y: -300,
    };
    expect(
      placeWindow({ defaults, minimum, saved, workAreas: [laptop] })
    ).toEqual({ bounds: { height: 875, width: 1400 }, maximized: true });
  });

  it("doesn't count a window whose title strip is off screen", () => {
    const saved = {
      height: 600,
      maximized: false,
      width: 800,
      x: 1480,
      y: 100,
    };
    const placed = placeWindow({
      defaults,
      minimum,
      saved,
      workAreas: [laptop],
    });
    expect(placed.bounds).not.toHaveProperty("x");
  });

  it("never opens smaller than the minimum", () => {
    const saved = { height: 100, maximized: false, width: 100, x: 10, y: 40 };
    expect(
      placeWindow({ defaults, minimum, saved, workAreas: [laptop] }).bounds
    ).toEqual({ height: 480, width: 720, x: 10, y: 40 });
  });
});

describe("windowStateOf", () => {
  it("rounds the bounds and keeps maximised", () => {
    expect(
      windowStateOf({ height: 860.4, width: 1280.6, x: 10.2, y: 40 }, true)
    ).toEqual({ height: 860, maximized: true, width: 1281, x: 10, y: 40 });
  });
});
