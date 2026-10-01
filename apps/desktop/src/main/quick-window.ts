import type { BrowserWindowConstructorOptions } from "electron";

import type { Platform } from "../shared/ipc";
import type { Rect } from "./window-state";

// Where the Quick AI window goes and how tall it is (118). Pure: main reads
// the display under the pointer and the page's preferred size, these decide.

export const QUICK_WINDOW = {
  /**
   * The page grows up to this, then its reply scrolls (the page's own cap,
   * `max-h-140` in apps/web's quick screen, is the same 560px).
   */
  maxHeight: 560,
  /** The strip alone: the input's one line (135). */
  minHeight: 60,
  /** About Raycast's width (135). */
  width: 720,
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
 * pointer): centred across, and a little above the middle, as launchers sit
 * (135): the tallest the window gets has a third of the room left over
 * (inside the margins) above it and two thirds below. Its top stays put as a reply makes it
 * grow, so the strip never moves under the cursor.
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
    y: Math.round(
      workArea.y + MARGIN + (workArea.height - 2 * MARGIN - tallest) / 3
    ),
  };
};

/**
 * The window's native look (135). On macOS a floating panel (over full-screen
 * apps and every Space) of the system's translucent popover material, with
 * its rounded corners and shadow: the window is see-through and the page
 * (`/quick`) drops its own background, so the material is all there is
 * behind the strip. The material follows the system's light or dark, and
 * stays lit when the window isn't key. Elsewhere, a plain frameless window.
 */
export const quickWindowLook = (
  platform: Platform
): BrowserWindowConstructorOptions =>
  platform === "mac"
    ? {
        hasShadow: true,
        roundedCorners: true,
        transparent: true,
        type: "panel",
        vibrancy: "popover",
        visualEffectState: "active",
      }
    : {};
