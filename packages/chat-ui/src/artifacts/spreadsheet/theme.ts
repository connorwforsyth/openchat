import type { Theme } from "@glideapps/glide-data-grid";

// The grid in the theme's tokens (166). Glide draws on a canvas and does
// its own colour arithmetic, so it needs colours as values, not `var()`s:
// each token is read from the page's computed style and resolved by a
// canvas to its red, green, blue and alpha, written back as hex. Nothing
// here names a colour; switch the theme and the grid follows.

/** A resolved colour: 0–255 channels, alpha included. */
export interface Rgba {
  readonly a: number;
  readonly b: number;
  readonly g: number;
  readonly r: number;
}

const hexByte = (value: number) =>
  Math.round(Math.min(255, Math.max(0, value)))
    .toString(16)
    .padStart(2, "0");

/** A colour as Glide reads one, with `alpha` (0–1) over its own. */
export const toHex = (colour: Rgba, alpha = 1): string =>
  `#${hexByte(colour.r)}${hexByte(colour.g)}${hexByte(colour.b)}${hexByte(colour.a * alpha)}`;

/** The theme's tokens the grid uses, resolved. */
export type GridTokens = Readonly<
  Record<
    | "accent"
    | "background"
    | "border"
    | "destructive"
    | "foreground"
    | "muted"
    | "mutedForeground"
    | "primary"
    | "primaryForeground"
    | "ring",
    Rgba
  >
> & { readonly fontFamily: string };

/** Glide's theme from the tokens. Pure. */
export const gridTheme = (tokens: GridTokens): Partial<Theme> => ({
  accentColor: toHex(tokens.ring),
  accentFg: toHex(tokens.primaryForeground),
  accentLight: toHex(tokens.ring, 0.16),
  bgBubble: toHex(tokens.muted),
  bgBubbleSelected: toHex(tokens.accent),
  bgCell: toHex(tokens.background),
  bgCellMedium: toHex(tokens.muted),
  bgHeader: toHex(tokens.muted),
  bgHeaderHasFocus: toHex(tokens.accent),
  bgHeaderHovered: toHex(tokens.accent),
  bgIconHeader: toHex(tokens.mutedForeground),
  bgSearchResult: toHex(tokens.ring, 0.24),
  borderColor: toHex(tokens.border),
  drilldownBorder: toHex(tokens.border),
  fgIconHeader: toHex(tokens.background),
  fontFamily: tokens.fontFamily,
  headerBottomBorderColor: toHex(tokens.border),
  horizontalBorderColor: toHex(tokens.border),
  linkColor: toHex(tokens.primary),
  textBubble: toHex(tokens.foreground),
  textDark: toHex(tokens.foreground),
  textHeader: toHex(tokens.mutedForeground),
  textHeaderSelected: toHex(tokens.primaryForeground),
  textLight: toHex(tokens.mutedForeground, 0.7),
  textMedium: toHex(tokens.mutedForeground),
});

const TOKENS = {
  accent: "--accent",
  background: "--background",
  border: "--border",
  destructive: "--destructive",
  foreground: "--foreground",
  muted: "--muted",
  mutedForeground: "--muted-foreground",
  primary: "--primary",
  primaryForeground: "--primary-foreground",
  ring: "--ring",
} as const;

const TRANSPARENT: Rgba = { a: 0, b: 0, g: 0, r: 0 };

/**
 * The tokens as they're computed under `element` (so a `.dark` ancestor
 * counts), each colour resolved by a 1×1 canvas. The browser shell.
 */
export const readGridTokens = (element: Element): GridTokens => {
  const style = getComputedStyle(element);
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const resolve = (token: string): Rgba => {
    const value = style.getPropertyValue(token).trim();
    if (!(context && value)) {
      return TRANSPARENT;
    }
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = value;
    context.fillRect(0, 0, 1, 1);
    const [r = 0, g = 0, b = 0, a = 0] = context.getImageData(0, 0, 1, 1).data;
    return { a, b, g, r };
  };
  const colours = Object.fromEntries(
    Object.entries(TOKENS).map(([name, token]) => [name, resolve(token)])
  ) as Record<keyof typeof TOKENS, Rgba>;
  return {
    ...colours,
    fontFamily:
      style.getPropertyValue("--font-sans").trim() || style.fontFamily,
  };
};
