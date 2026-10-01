import { describe, expect, it } from "vitest";

import { drawTrayIcon, TRAY_ICON_POINTS } from "./tray-icon";

const alphaAt = (
  bitmap: ReturnType<typeof drawTrayIcon>,
  x: number,
  y: number
) => bitmap.buffer[(y * bitmap.width + x) * 4 + 3] ?? 0;

describe("drawTrayIcon", () => {
  it.each([1, 2])("draws %ix at the menu bar's size", (scale) => {
    const bitmap = drawTrayIcon(scale);
    const size = TRAY_ICON_POINTS * scale;
    expect(bitmap).toMatchObject({
      height: size,
      scaleFactor: scale,
      width: size,
    });
    expect(bitmap.buffer).toHaveLength(size * size * 4);
  });

  it("is black with alpha, as a template image needs", () => {
    const { buffer } = drawTrayIcon(2);
    for (let index = 0; index < buffer.length; index += 4) {
      expect([buffer[index], buffer[index + 1], buffer[index + 2]]).toEqual([
        0, 0, 0,
      ]);
    }
  });

  it("draws an outline: inked edge, empty middle and corners", () => {
    const bitmap = drawTrayIcon(2);
    // The bubble's top edge, its hollow middle, and the empty corner.
    expect(alphaAt(bitmap, 16, 4)).toBeGreaterThan(200);
    expect(alphaAt(bitmap, 16, 14)).toBe(0);
    expect(alphaAt(bitmap, 31, 31)).toBe(0);
    // The tail under the left side.
    expect(alphaAt(bitmap, 9, 25)).toBeGreaterThan(200);
  });
});
