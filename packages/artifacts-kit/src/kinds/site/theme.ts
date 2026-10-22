import {
  EMPTY_THEME,
  type KindTheme,
  themeDeclarations,
} from "../../kind-theme";
// The instance's theme, for sites (125). The theme lives in one place,
// `packages/ui/src/styles/globals.css` (AGENTS.md), so a site's Tailwind
// isn't given a copy: it's given that file's text and takes the token
// blocks out of it. Sites get the same semantic utilities as the app
// (`bg-background`, `text-muted-foreground`, `border-border`, `rounded-lg`),
// and switch to the dark tokens with the visitor's system setting.

/** The semantic colours a site styles with, as Tailwind colour names. */
export const SITE_THEME_COLORS = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "border",
  "input",
  "ring",
  "chart-1",
  "chart-2",
  "chart-3",
  "chart-4",
  "chart-5",
] as const;

const CSS_COMMENT = /\/\*[\s\S]*?\*\//g;

/** Where the block opened at `open` closes; -1 if it never does. */
const closingBrace = (css: string, open: number): number => {
  let depth = 0;
  for (let index = open; index < css.length; index += 1) {
    if (css[index] === "{") {
      depth += 1;
    } else if (css[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
};

/**
 * The body of the first top-level rule whose prelude is `prelude` (say
 * `:root` or `@theme inline`), without its braces; `null` if there's none.
 */
export const ruleBody = (css: string, prelude: string): string | null => {
  // Comments are dropped from preludes only: a string such as
  // `@source "dist/*.js"` holds what looks like one.
  const text = css;
  let start = 0;
  while (start < text.length) {
    const open = text.indexOf("{", start);
    const close = open === -1 ? -1 : closingBrace(text, open);
    if (close === -1) {
      return null;
    }
    // A statement like `@import "x";` ends before the rule's prelude.
    const head = text.slice(start, open);
    const statement = head.slice(head.lastIndexOf(";") + 1);
    if (statement.replace(CSS_COMMENT, "").trim() === prelude) {
      return text.slice(open + 1, close);
    }
    start = close + 1;
  }
  return null;
};

const FONT_TOKEN = /^\s*--font-[\w-]+\s*:[^;]*;\s*$/gm;

/**
 * The Tailwind input for a site, from the instance's `globals.css`: Tailwind
 * itself, the theme's `@theme inline` mapping, its light tokens, and its
 * dark tokens under `prefers-color-scheme: dark`. The app's font tokens are
 * left out (the app sets them with its own font loader, which a site
 * doesn't have), so sites use Tailwind's system stack unless they load a
 * font.
 */
export const siteTailwindInput = (
  globalsCss: string,
  brand: KindTheme = EMPTY_THEME
): string => {
  const theme = ruleBody(globalsCss, "@theme inline")?.replace(FONT_TOKEN, "");
  const light = ruleBody(globalsCss, ":root");
  const dark = ruleBody(globalsCss, ".dark");
  const brandLight = themeDeclarations(brand, "light");
  const brandDark = themeDeclarations(brand, "dark");
  return [
    '@import "tailwindcss";',
    ...(theme ? [`@theme inline {${theme}}`] : []),
    ...(light ? [`:root {${light}}`] : []),
    ...(dark
      ? [`@media (prefers-color-scheme: dark) {\n  :root {${dark}}\n}`]
      : []),
    // The instance's own values (`brand/…/theme.css`), over the app's.
    ...(brandLight ? [`:root {${brandLight}}`] : []),
    ...(brandDark
      ? [`@media (prefers-color-scheme: dark) {\n  :root {${brandDark}}\n}`]
      : []),
    // What the app's base layer does, so a page starts on the theme.
    `@layer base {
  *, ::before, ::after { border-color: var(--border); }
  html { color-scheme: light dark; }
  body { background-color: var(--background); color: var(--foreground); }
}`,
  ].join("\n");
};
