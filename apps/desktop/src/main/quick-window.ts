import type { Rect } from "./window-state";

// Where the Quick AI window goes and how tall it is (118). Pure: main reads
// the display under the pointer and the page's preferred size, these decide.

export const QUICK_WINDOW = {
  /** The page grows up to this, then scrolls. */
  maxHeight: 560,
  /** The composer alone. */
  minHeight: 96,
  width: 680,
} as const;

/** How much room to leave at a display's edges. */
const MARGIN = 16;

/**
 * The window's height for the page's preferred height: at least the
 * composer, at most `maxHeight` (or the display, if that's smaller).
 */
export const quickHeight = (
  preferred: number,
  workArea: Pick<Rect, "height">,
  { maxHeight, minHeight } = QUICK_WINDOW
): number =>
  Math.round(
    Math.max(
      minHeight,
      Math.min(preferred, maxHeight, workArea.height - 2 * MARGIN)
    )
  );

/**
 * The window's spot on the display the person is using (the one under the
 * pointer): centred across, and down so that the tallest the window gets
 * would be centred too. Its top stays put as a reply makes it grow, so the
 * composer never moves under the cursor.
 */
export const placeQuickWindow = (
  workArea: Rect,
  { maxHeight, width } = QUICK_WINDOW
): Rect => {
  const fittedWidth = Math.min(width, workArea.width - 2 * MARGIN);
  const tallest = Math.min(maxHeight, workArea.height - 2 * MARGIN);
  return {
    height: tallest,
    width: Math.round(fittedWidth),
    x: Math.round(workArea.x + (workArea.width - fittedWidth) / 2),
    y: Math.round(workArea.y + (workArea.height - tallest) / 2),
  };
};
