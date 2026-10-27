import { describe, expect, it } from "vitest";

import { fractionIn, markFrom, moveCursor } from "./marks";

const size = { height: 400, width: 800 };

describe("markFrom", () => {
  it("makes a click a point where it began", () => {
    expect(markFrom({ x: 0.5, y: 0.5 }, { x: 0.502, y: 0.5 }, size)).toEqual({
      shape: "point",
      x: 0.5,
      y: 0.5,
    });
  });

  it("makes a drag the box it dragged out, whichever way it went", () => {
    expect(markFrom({ x: 0.6, y: 0.8 }, { x: 0.2, y: 0.3 }, size)).toEqual({
      height: expect.closeTo(0.5),
      shape: "region",
      width: expect.closeTo(0.4),
      x: 0.2,
      y: 0.3,
    });
  });
});

describe("fractionIn", () => {
  it("keeps a pointer outside the area on its edge", () => {
    const area = { height: 100, left: 10, top: 20, width: 200 };
    expect(fractionIn({ x: 110, y: 70 }, area)).toEqual({ x: 0.5, y: 0.5 });
    expect(fractionIn({ x: -50, y: 500 }, area)).toEqual({ x: 0, y: 1 });
  });
});

describe("moveCursor", () => {
  it("moves by a small step, or a big one with Shift, and stays inside", () => {
    expect(moveCursor({ x: 0.5, y: 0.5 }, "ArrowRight", false)?.x).toBeCloseTo(
      0.52
    );
    expect(moveCursor({ x: 0.5, y: 0.5 }, "ArrowUp", true)?.y).toBeCloseTo(0.4);
    expect(moveCursor({ x: 0, y: 0 }, "ArrowLeft", true)).toEqual({
      x: 0,
      y: 0,
    });
    expect(moveCursor({ x: 0, y: 0 }, "a", false)).toBeNull();
  });
});
