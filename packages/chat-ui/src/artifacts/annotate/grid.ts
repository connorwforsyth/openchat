import type { AnnotationTarget } from "@workspace/ai/messages/annotations";

import type { ClientBox } from "./locate";

// A canvas grid (a spreadsheet) draws no element per cell, so the layer
// can't read one from the DOM: the grid says where each cell is, and this
// finds the cells under a mark from that.

export interface Bounds {
  readonly height: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
}

export type CellBounds = (col: number, row: number) => Bounds | undefined;

export interface Cell {
  readonly col: number;
  readonly row: number;
}

const inside = (value: number, start: number, size: number) =>
  value >= start && value < start + size;

/**
 * The cell at a client point: its column by a scan (sheets are narrow),
 * its row by bisection (they can be long). `null` off the cells. Pure
 * over `bounds`.
 */
export const gridCellAt = (
  bounds: CellBounds,
  size: { readonly cols: number; readonly rows: number },
  point: { readonly x: number; readonly y: number }
): Cell | null => {
  let col = -1;
  for (let at = 0; at < size.cols && col < 0; at += 1) {
    const box = bounds(at, 0);
    if (box && inside(point.x, box.x, box.width)) {
      col = at;
    }
  }
  let low = 0;
  let high = size.rows - 1;
  while (col >= 0 && low <= high) {
    const row = Math.floor((low + high) / 2);
    const box = bounds(col, row);
    if (!box) {
      return null;
    }
    if (point.y < box.y) {
      high = row - 1;
    } else if (point.y >= box.y + box.height) {
      low = row + 1;
    } else {
      return { col, row };
    }
  }
  return null;
};

/**
 * The range a mark covers on a grid, as a note's target: the cell at a
 * point, or the corners of a box (its centre's cell when a corner is off
 * the cells).
 */
export const gridTarget = (
  box: ClientBox,
  find: (point: { readonly x: number; readonly y: number }) => Cell | null,
  address: (cell: Cell) => string,
  sheet: string
): AnnotationTarget | null => {
  const centre = find(box);
  const start =
    find({ x: box.x - box.width / 2, y: box.y - box.height / 2 }) ?? centre;
  const end =
    find({ x: box.x + box.width / 2, y: box.y + box.height / 2 }) ?? centre;
  if (!(start && end)) {
    return null;
  }
  const from = address(start);
  const to = address(end);
  return {
    range: from === to ? from : `${from}:${to}`,
    sheet: sheet.slice(0, 100),
    type: "cells",
  };
};
