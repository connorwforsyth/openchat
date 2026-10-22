import { z } from "zod";

// A rendered slide as data (164): what the PowerPoint and PDF exports are
// made from. The runtime walks each slide's DOM into this tree
// (`./slide-capture`), and the exports map it to native shapes, text boxes
// and pictures (`./slide-export`), so the mapping is pure and testable
// without a browser. Positions and sizes are canvas pixels (1920×1080).

export const layoutColorSchema = z.object({
  /** Opacity, 0 to 1. */
  a: z.number().min(0).max(1),
  b: z.number().int().min(0).max(255),
  g: z.number().int().min(0).max(255),
  r: z.number().int().min(0).max(255),
});
export type LayoutColor = z.infer<typeof layoutColorSchema>;

const boxSchema = z.object({
  h: z.number(),
  w: z.number(),
  x: z.number(),
  y: z.number(),
});

/**
 * What a slide-ui `Chart` carries on its figure as `data-slide-chart`: the
 * data as drawn, which the PowerPoint export makes a native chart from.
 */
export const slideChartSchema = z.object({
  labels: z.array(z.string()),
  series: z.array(z.object({ name: z.string(), values: z.array(z.number()) })),
  type: z.enum(["bar", "line", "pie"]),
});
export type SlideChart = z.infer<typeof slideChartSchema>;

export const layoutItemSchema = z.discriminatedUnion("type", [
  boxSchema.extend({
    fill: layoutColorSchema.nullable(),
    line: z
      .object({ color: layoutColorSchema, width: z.number().min(0) })
      .nullable(),
    radius: z.number().min(0),
    type: z.literal("shape"),
  }),
  boxSchema.extend({
    align: z.enum(["center", "left", "right"]),
    bold: z.boolean(),
    /** A list item's marker, drawn by the export rather than the text. */
    bullet: z.enum(["none", "bullet", "number"]),
    color: layoutColorSchema,
    fontSize: z.number().positive(),
    italic: z.boolean(),
    /** Line height as a multiple of the font size. */
    lineHeight: z.number().positive(),
    text: z.string(),
    type: z.literal("text"),
  }),
  boxSchema.extend({
    /** A `data:` URL: exports embed pictures, they never fetch them. */
    src: z.string().startsWith("data:image/"),
    type: z.literal("image"),
  }),
  boxSchema.extend({
    chart: slideChartSchema,
    /** The theme's chart colours (`--chart-1` on), one per series or slice. */
    colors: z.array(layoutColorSchema).min(1),
    /** The axis and legend text. */
    fontSize: z.number().positive(),
    labelColor: layoutColorSchema,
    type: z.literal("chart"),
  }),
]);
export type LayoutItem = z.infer<typeof layoutItemSchema>;

export const slideLayoutSchema = z.object({
  background: layoutColorSchema.nullable(),
  /** Back to front, as the slide paints them. */
  items: z.array(layoutItemSchema),
  notes: z.string(),
  /**
   * The slide as the browser drew it, for the PDF, which shows this and
   * keeps `items`' text as an invisible, selectable layer. `null` when the
   * slide wasn't drawn (it failed) or the export doesn't need it.
   */
  picture: z.string().startsWith("data:image/").nullable(),
});
export type SlideLayout = z.infer<typeof slideLayoutSchema>;

export const deckLayoutSchema = z.object({
  slides: z.array(slideLayoutSchema),
  title: z.string(),
});
export type DeckLayout = z.infer<typeof deckLayoutSchema>;

/** `color` as six hex digits, as PowerPoint and PDF take it. */
export const hexOf = (color: LayoutColor): string =>
  [color.r, color.g, color.b]
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
