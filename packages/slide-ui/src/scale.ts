// The fixed canvas and type scale every slide is drawn on (164), after
// open-slide's slide-authoring rules: one 1920×1080 canvas, scaled to fit
// whatever shows it, and a handful of sizes so slides read as one deck.
// Pixels on the canvas, not on the screen.

export const SLIDE_WIDTH = 1920;
export const SLIDE_HEIGHT = 1080;

/** The canvas's inner margin: content stays inside it. */
export const SLIDE_PADDING = { block: 112, inline: 144 } as const;

/** Font sizes, largest first. */
export const SLIDE_TYPE = {
  body: 40,
  caption: 28,
  display: 128,
  eyebrow: 26,
  heading: 64,
  title: 96,
} as const;

/** The space between things, in steps of 8. */
export const SLIDE_SPACE = { lg: 64, md: 40, sm: 24, xl: 96, xs: 12 } as const;

/**
 * The theme's colours, as CSS variables from `@workspace/ui`'s globals.css
 * (the only place the theme lives); the page showing a slide defines them.
 */
export const SLIDE_COLOR = {
  accent: "var(--primary)",
  accentForeground: "var(--primary-foreground)",
  background: "var(--background)",
  border: "var(--border)",
  foreground: "var(--foreground)",
  muted: "var(--muted)",
  mutedForeground: "var(--muted-foreground)",
} as const;

export const SLIDE_FONT =
  "var(--slide-font, ui-sans-serif, system-ui, sans-serif)";
