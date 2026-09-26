import localFont from "next/font/local";

// Geist from the `geist` npm package rather than `next/font/google`, so builds
// never download fonts (offline, air-gapped and CI builds all work). The files
// are loaded directly instead of via `geist/font/*` because that export fixes
// the CSS variables to `--font-geist-*`, and the theme reads `--font-sans` and
// `--font-mono`.

export const fontSans = localFont({
  src: "../node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2",
  variable: "--font-sans",
  weight: "100 900",
});

export const fontMono = localFont({
  adjustFontFallback: false,
  fallback: [
    "ui-monospace",
    "SFMono-Regular",
    "Menlo",
    "Monaco",
    "Liberation Mono",
    "monospace",
  ],
  src: "../node_modules/geist/dist/fonts/geist-mono/GeistMono-Variable.woff2",
  variable: "--font-mono",
  weight: "100 900",
});
