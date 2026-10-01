// The menu bar icon's fallback (118): drawn here, for a build whose .brand/
// has no template image (119 makes one from the brand's logo). A speech
// bubble's outline, black on transparent, which macOS uses as a template
// image (it recolours it for light and dark menu bars and the highlighted
// state).

/** The icon's size in points; macOS menu bar icons are 16–18pt. */
export const TRAY_ICON_POINTS = 16;

export interface TrayBitmap {
  /** Premultiplied 32-bit pixels, row by row; only alpha varies. */
  readonly buffer: Buffer;
  readonly height: number;
  readonly scaleFactor: number;
  readonly width: number;
}

interface RoundedRect {
  readonly cx: number;
  readonly cy: number;
  readonly halfH: number;
  readonly halfW: number;
  readonly radius: number;
}

/** Distance from a point to a rounded rectangle's edge (negative inside). */
const roundedRectDistance = (
  px: number,
  py: number,
  { cx, cy, halfH, halfW, radius }: RoundedRect
): number => {
  const qx = Math.abs(px - cx) - (halfW - radius);
  const qy = Math.abs(py - cy) - (halfH - radius);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  return outside + Math.min(Math.max(qx, qy), 0) - radius;
};

/** Whether a point is inside the bubble's tail, a triangle under its left side. */
const inTail = (x: number, y: number): boolean => {
  // In points: from (4, 11.5) down to (4, 14.5) and back up to (7.5, 11.5).
  const top = 11.5;
  const bottom = 14.5;
  if (y < top || y > bottom) {
    return false;
  }
  const along = (y - top) / (bottom - top);
  return x >= 4 && x <= 7.5 - along * 3.5;
};

/**
 * The icon at `scaleFactor` (1 or 2), coverage sampled 4×4 per pixel so the
 * curves are smooth. Pure, so it's tested without Electron.
 */
export const drawTrayIcon = (scaleFactor: number): TrayBitmap => {
  const size = TRAY_ICON_POINTS * scaleFactor;
  const buffer = Buffer.alloc(size * size * 4);
  const bubble: RoundedRect = {
    cx: 8,
    cy: 7,
    halfH: 5.25,
    halfW: 6.5,
    radius: 3,
  };
  const stroke = 1.5;
  const samples = 4;
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      let covered = 0;
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const x = (column + (sx + 0.5) / samples) / scaleFactor;
          const y = (row + (sy + 0.5) / samples) / scaleFactor;
          const distance = roundedRectDistance(x, y, bubble);
          const onOutline = Math.abs(distance + stroke / 2) <= stroke / 2;
          const tail = distance > -stroke && inTail(x, y);
          if (onOutline || tail) {
            covered += 1;
          }
        }
      }
      // Black, so premultiplied colour stays 0 and only alpha carries it.
      buffer[(row * size + column) * 4 + 3] = Math.round(
        (255 * covered) / (samples * samples)
      );
    }
  }
  return { buffer, height: size, scaleFactor, width: size };
};
