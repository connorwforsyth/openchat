import { describe, expect, it } from "vitest";

import { type CellBounds, gridCellAt, gridTarget } from "./grid";

// A 4 × 1000 grid of 100 × 20 cells, starting at (50, 30).
const bounds: CellBounds = (col, row) => ({
  height: 20,
  width: 100,
  x: 50 + col * 100,
  y: 30 + row * 20,
});
const size = { cols: 4, rows: 1000 };
const address = ({ col, row }: { col: number; row: number }) =>
  `${"ABCD"[col]}${row + 1}`;
const find = (point: { x: number; y: number }) =>
  gridCellAt(bounds, size, point);

describe("gridCellAt", () => {
  it("finds the cell under a point, deep in a long sheet", () => {
    expect(find({ x: 260, y: 30 + 20 * 777 + 5 })).toEqual({
      col: 2,
      row: 777,
    });
  });

  it("finds nothing off the cells", () => {
    expect(find({ x: 10, y: 40 })).toBeNull();
    expect(find({ x: 60, y: 30 + 20 * 1000 + 1 })).toBeNull();
  });
});

describe("gridTarget", () => {
  it("names one cell for a point and a range for a box", () => {
    expect(
      gridTarget({ height: 0, width: 0, x: 60, y: 35 }, find, address, "Q3")
    ).toEqual({ range: "A1", sheet: "Q3", type: "cells" });
    expect(
      gridTarget({ height: 60, width: 200, x: 200, y: 70 }, find, address, "Q3")
    ).toEqual({ range: "A1:C4", sheet: "Q3", type: "cells" });
  });
});
