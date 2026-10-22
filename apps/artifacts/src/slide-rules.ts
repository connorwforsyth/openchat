import { SLIDE_SIZE } from "@workspace/artifacts-kit/kinds/presentation/content";
import { err, ok, type Result } from "@workspace/shared/result";

import {
  type LayoutColor,
  type LayoutItem,
  type SlideLayout,
  slideChartSchema,
} from "./slide-layout";

// The decisions the slide capture makes, as pure functions over what it
// read from the DOM: which elements PowerPoint can't draw natively (they
// become a picture of their region), what a chart's data says, and what
// a slide that failed to draw exports as.

export type Box = Pick<LayoutItem, "h" | "w" | "x" | "y">;

/** Computed styles a native shape or text box can't express, unless `none`. */
const UNMAPPED_STYLES = [
  "backgroundImage",
  "transform",
  "boxShadow",
  "filter",
  "backdropFilter",
  "clipPath",
  "maskImage",
] as const;

/** Elements whose drawing only a picture keeps. */
const PICTURE_TAGS = ["svg", "canvas"] as const;

export type RasterFacts = Readonly<
  Record<(typeof UNMAPPED_STYLES)[number], string> & { tag: string }
>;

export type RasterReason =
  | (typeof UNMAPPED_STYLES)[number]
  | (typeof PICTURE_TAGS)[number];

/** Why an element must be a picture of its region, or `null` if it maps natively. */
export const rasterReason = (facts: RasterFacts): RasterReason | null => {
  const tag = facts.tag.toLowerCase();
  const picture = PICTURE_TAGS.find((each) => each === tag);
  if (picture) {
    return picture;
  }
  return (
    UNMAPPED_STYLES.find(
      (property) => facts[property] !== "" && facts[property] !== "none"
    ) ?? null
  );
};

/** How far past its box an element of each kind may paint (a shadow, a blur). */
export const RASTER_BLEED: Readonly<Record<RasterReason, number>> = {
  backdropFilter: 0,
  backgroundImage: 0,
  boxShadow: 96,
  canvas: 0,
  clipPath: 0,
  filter: 96,
  maskImage: 0,
  svg: 0,
  transform: 0,
};

/** `box` grown by `bleed` on every side (shadows, blurs), kept on the canvas, in whole pixels. */
export const regionOf = (box: Box, bleed: number): Box => {
  const x = Math.max(0, Math.floor(box.x - bleed));
  const y = Math.max(0, Math.floor(box.y - bleed));
  const right = Math.min(SLIDE_SIZE.width, Math.ceil(box.x + box.w + bleed));
  const bottom = Math.min(SLIDE_SIZE.height, Math.ceil(box.y + box.h + bleed));
  return { h: Math.max(0, bottom - y), w: Math.max(0, right - x), x, y };
};

/**
 * The smallest box holding every pixel more than `threshold` opaque, in
 * RGBA `data` of `width` × `height`, or `null` if none is.
 */
export const opaqueBounds = (
  data: Readonly<ArrayLike<number>>,
  width: number,
  height: number,
  threshold = 2
): Box | null => {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if ((data[(y * width + x) * 4 + 3] ?? 0) > threshold) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
  }
  return right < 0
    ? null
    : { h: bottom - top + 1, w: right - left + 1, x: left, y: top };
};

export interface ChartLook {
  readonly colors: readonly LayoutColor[];
  readonly fontSize: number;
  readonly labelColor: LayoutColor;
}

/** A `data-slide-chart` attribute as a chart item at `box`, or why it can't be one. */
export const chartItemOf = (
  attribute: string,
  box: Box,
  look: ChartLook
): Result<LayoutItem, string> => {
  let json: unknown;
  try {
    json = JSON.parse(attribute);
  } catch {
    return err("data-slide-chart isn't JSON");
  }
  const chart = slideChartSchema.safeParse(json);
  if (!chart.success) {
    return err(chart.error.issues[0]?.message ?? "isn't a chart");
  }
  if (look.colors.length === 0) {
    return err("the theme has no chart colours");
  }
  return ok({
    ...box,
    chart: chart.data,
    colors: [...look.colors],
    fontSize: look.fontSize,
    labelColor: look.labelColor,
    type: "chart",
  });
};

/**
 * The page a slide that failed to draw exports as: what the overview's
 * error card says (its number and id, and why), so the deck keeps its
 * order and the reader sees which slide to fix.
 */
export const failedSlideLayout = (
  failure: {
    readonly id: string;
    readonly message: string;
    readonly notes: string;
    readonly number: number;
  },
  colors: {
    readonly background: LayoutColor | null;
    readonly foreground: LayoutColor;
    readonly muted: LayoutColor;
  }
): SlideLayout => {
  const text = {
    align: "left",
    bullet: "none",
    italic: false,
    type: "text",
    w: SLIDE_SIZE.width - 288,
    x: 144,
  } as const;
  return {
    background: colors.background,
    items: [
      {
        ...text,
        bold: true,
        color: colors.foreground,
        fontSize: 64,
        h: 80,
        lineHeight: 1.2,
        text: `${failure.number} · ${failure.id}`,
        y: 112,
      },
      {
        ...text,
        bold: false,
        color: colors.muted,
        fontSize: 32,
        h: SLIDE_SIZE.height - 336,
        lineHeight: 1.4,
        text: failure.message,
        y: 224,
      },
    ],
    notes: failure.notes,
    picture: null,
  };
};
