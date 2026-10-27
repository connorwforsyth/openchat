import type { AnnotationMark } from "@workspace/ai/messages/annotations";

// Marks as the annotate layer makes them: fractions of its area, so they
// stay where they were put when the panel is resized.

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** A drag shorter than this, in pixels, is a click. */
export const DRAG_THRESHOLD_PX = 6;

const unit = (value: number) => Math.min(1, Math.max(0, value));

/** `client` as a fraction of `area`, kept inside it. Pure. */
export const fractionIn = (
  client: Point,
  area: Pick<DOMRect, "height" | "left" | "top" | "width">
): Point => ({
  x: area.width > 0 ? unit((client.x - area.left) / area.width) : 0,
  y: area.height > 0 ? unit((client.y - area.top) / area.height) : 0,
});

/**
 * The mark a press from `start` to `end` makes over an area `size` pixels
 * big: a point where it began, or the box it dragged out. Pure.
 */
export const markFrom = (
  start: Point,
  end: Point,
  size: { readonly height: number; readonly width: number }
): AnnotationMark => {
  const dx = (end.x - start.x) * size.width;
  const dy = (end.y - start.y) * size.height;
  if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) {
    return { shape: "point", x: start.x, y: start.y };
  }
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  return {
    height: Math.abs(end.y - start.y),
    shape: "region",
    width: Math.abs(end.x - start.x),
    x,
    y,
  };
};

/** Where a mark's pin sits: the point, or the box's top corner. Pure. */
export const anchorOf = (mark: AnnotationMark): Point => ({
  x: mark.x,
  y: mark.y,
});

/** How far an arrow key moves the keyboard cursor; Shift moves further. */
const STEP = 0.02;
const BIG_STEP = 0.1;

const ARROWS: Readonly<Record<string, Point>> = {
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
};

/** The keyboard cursor after `key`, or `null` when it isn't an arrow. Pure. */
export const moveCursor = (
  cursor: Point,
  key: string,
  big: boolean
): Point | null => {
  const direction = ARROWS[key];
  if (!direction) {
    return null;
  }
  const step = big ? BIG_STEP : STEP;
  return {
    x: unit(cursor.x + direction.x * step),
    y: unit(cursor.y + direction.y * step),
  };
};
