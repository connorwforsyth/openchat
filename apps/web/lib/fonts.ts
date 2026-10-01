import type { FontsConfig } from "@workspace/config/schema";
import localFont from "next/font/local";

// Every interface font the app offers, from npm packages rather than
// `next/font/google`, so builds never download fonts (offline, air-gapped and
// CI builds all work). `fonts:` in app.config.yaml picks one sans and one mono
// (`fontClasses`); each sets `--font-sans` or `--font-mono`, which the theme
// reads, and the browser only downloads the faces a page uses.
//
// next/font needs each call at module scope with literal options, hence one
// constant per font. Geist's files are loaded directly because `geist/font/*`
// fixes the variables to `--font-geist-*`. The others are Fontsource's Latin
// variable subsets.

const MONO_FALLBACK = [
  "ui-monospace",
  "SFMono-Regular",
  "Menlo",
  "Monaco",
  "Liberation Mono",
  "monospace",
];

const geist = localFont({
  src: "../node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2",
  variable: "--font-sans",
  weight: "100 900",
});

const inter = localFont({
  src: "../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
  variable: "--font-sans",
  weight: "100 900",
});

const ibmPlexSans = localFont({
  src: "../node_modules/@fontsource-variable/ibm-plex-sans/files/ibm-plex-sans-latin-wght-normal.woff2",
  variable: "--font-sans",
  weight: "100 700",
});

const figtree = localFont({
  src: "../node_modules/@fontsource-variable/figtree/files/figtree-latin-wght-normal.woff2",
  variable: "--font-sans",
  weight: "300 900",
});

const manrope = localFont({
  src: "../node_modules/@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2",
  variable: "--font-sans",
  weight: "200 800",
});

const geistMono = localFont({
  adjustFontFallback: false,
  fallback: MONO_FALLBACK,
  src: "../node_modules/geist/dist/fonts/geist-mono/GeistMono-Variable.woff2",
  variable: "--font-mono",
  weight: "100 900",
});

const jetbrainsMono = localFont({
  adjustFontFallback: false,
  fallback: MONO_FALLBACK,
  src: "../node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2",
  variable: "--font-mono",
  weight: "100 800",
});

const sans = {
  figtree,
  geist,
  "ibm-plex-sans": ibmPlexSans,
  inter,
  manrope,
} satisfies Record<FontsConfig["sans"], unknown>;

const mono = {
  "geist-mono": geistMono,
  "jetbrains-mono": jetbrainsMono,
} satisfies Record<FontsConfig["mono"], unknown>;

const DEFAULT_FONTS: FontsConfig = { mono: "geist-mono", sans: "geist" };

/** The classes that set `--font-sans` and `--font-mono` for the chosen fonts. */
export const fontClasses = (fonts: FontsConfig = DEFAULT_FONTS): string[] => [
  mono[fonts.mono].variable,
  sans[fonts.sans].variable,
];
