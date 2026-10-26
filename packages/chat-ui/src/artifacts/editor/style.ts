import { z } from "zod";

// The styles an artifact editor's inspector reads and writes, shared by
// every kind's editor: what a picked element (a slide's heading, later a
// spreadsheet's cell) is drawn with, and the change a field makes. Colours
// travel as `#rrggbb`, what a colour input takes; a theme colour is written
// as its variable, so it follows the theme.

/** A colour as a colour field takes it. */
export const hexColorSchema = z.string().regex(/^#[\da-f]{6}$/);

/** How an element is drawn, as the inspector shows it. */
export const elementStyleSchema = z.object({
  /** `null` when it has none of its own (transparent). */
  backgroundColor: hexColorSchema.nullable(),
  color: hexColorSchema,
  fontSize: z.number().min(0).max(4000),
  fontStyle: z.enum(["italic", "normal"]),
  fontWeight: z.number().int().min(1).max(1000),
  letterSpacing: z.number().min(-1000).max(1000),
  /** A multiple of the font size; `null` for the browser's normal. */
  lineHeight: z.number().min(0).max(100).nullable(),
  opacity: z.number().min(0).max(1),
  textAlign: z.enum(["center", "end", "justify", "start"]),
});
export type ElementStyle = z.infer<typeof elementStyleSchema>;

/** One of the theme's colours, by its CSS variable's name (`primary`). */
export const themeColorSchema = z.object({
  name: z.string().regex(/^[a-z][a-z\d-]{0,39}$/),
  value: hexColorSchema,
});
export type ThemeColor = z.infer<typeof themeColorSchema>;

/** The CSS keys the inspector writes; each field sets one. */
export type StyleKey = keyof ElementStyle;

/** A field's change: a CSS value for `key`, or `null` to drop it. */
export interface StyleChange {
  readonly key: StyleKey;
  readonly value: string | null;
}

/** A theme colour as written into a style, so it follows the theme. */
export const themeColorValue = (name: string): string => `var(--${name})`;
