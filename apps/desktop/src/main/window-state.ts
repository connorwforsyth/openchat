import { z } from "zod";

// Where the main window was, so the next launch puts it back (117). Pure:
// main reads the displays and the window, these decide.

export const windowStateSchema = z.object({
  height: z.number().int().positive(),
  maximized: z.boolean().default(false),
  width: z.number().int().positive(),
  x: z.number().int(),
  y: z.number().int(),
});
export type WindowState = z.infer<typeof windowStateSchema>;

export interface Rect {
  readonly height: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
}

export interface Size {
  readonly height: number;
  readonly width: number;
}

/** What to open the window with: a size, and a position when the saved one is still on screen. */
export interface WindowPlacement {
  readonly bounds: Size & Partial<Pick<Rect, "x" | "y">>;
  readonly maximized: boolean;
}

/** How much of the window's top must be on a display for the saved spot to count. */
const VISIBLE_MIN = 64;

const overlap = (a: Rect, b: Rect) => ({
  height: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
  width: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
});

/**
 * Where to open the main window. The saved bounds when their top strip (the
 * part you drag by) is on one of today's displays; otherwise the saved size,
 * fitted to the primary display and left for the OS to place. A first run,
 * or an unplugged monitor, never opens it out of reach.
 */
export const placeWindow = ({
  defaults,
  minimum,
  saved,
  workAreas,
}: {
  readonly defaults: Size;
  readonly minimum: Size;
  readonly saved: WindowState | null;
  /** Each display's work area; the primary display first. */
  readonly workAreas: readonly Rect[];
}): WindowPlacement => {
  const [primary] = workAreas;
  const fitToPrimary = (wanted: Size): Size => ({
    height: Math.max(
      minimum.height,
      Math.min(wanted.height, primary?.height ?? wanted.height)
    ),
    width: Math.max(
      minimum.width,
      Math.min(wanted.width, primary?.width ?? wanted.width)
    ),
  });
  if (!saved) {
    return { bounds: fitToPrimary(defaults), maximized: false };
  }
  const titleStrip: Rect = { ...saved, height: Math.min(saved.height, 32) };
  const onScreen = workAreas.some((area) => {
    const shared = overlap(titleStrip, area);
    return shared.height > 0 && shared.width >= VISIBLE_MIN;
  });
  const size: Size = {
    height: Math.max(minimum.height, saved.height),
    width: Math.max(minimum.width, saved.width),
  };
  return onScreen
    ? {
        bounds: { ...size, x: saved.x, y: saved.y },
        maximized: saved.maximized,
      }
    : { bounds: fitToPrimary(size), maximized: saved.maximized };
};

/** What to save: the normal (unmaximised) bounds, and whether it was maximised. */
export const windowStateOf = (
  normalBounds: Rect,
  maximized: boolean
): WindowState =>
  windowStateSchema.parse({
    height: Math.round(normalBounds.height),
    maximized,
    width: Math.round(normalBounds.width),
    x: Math.round(normalBounds.x),
    y: Math.round(normalBounds.y),
  });
