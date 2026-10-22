import { z } from "zod";

// An instance's own look for an artifact kind (n2): `brand/theme.css` for
// every kind, then `brand/kinds/<kind>/theme.css`, layered over the
// module's defaults (the app theme). Only the artifact runtime reads them;
// they never reach the model. They hold values, not CSS: a `:root` block
// and a `.dark` block of custom properties, of the variables the kind
// declares. Anything else (selectors, at-rules, `url()`) is left out, so a
// theme file can't restyle the page or load anything.

/** The variables each themed kind lets a theme file set. */
export const KIND_THEME_VARIABLES = {
  presentation: [
    "--background",
    "--foreground",
    "--muted",
    "--muted-foreground",
    "--primary",
    "--primary-foreground",
    "--border",
    "--chart-1",
    "--chart-2",
    "--chart-3",
    "--chart-4",
    "--chart-5",
    "--radius",
    "--slide-font",
  ],
  site: [
    "--background",
    "--foreground",
    "--card",
    "--card-foreground",
    "--popover",
    "--popover-foreground",
    "--primary",
    "--primary-foreground",
    "--secondary",
    "--secondary-foreground",
    "--muted",
    "--muted-foreground",
    "--accent",
    "--accent-foreground",
    "--destructive",
    "--border",
    "--input",
    "--ring",
    "--chart-1",
    "--chart-2",
    "--chart-3",
    "--chart-4",
    "--chart-5",
    "--radius",
    "--font-sans",
  ],
} as const;
export type ThemedKind = keyof typeof KIND_THEME_VARIABLES;
export const THEMED_KINDS = Object.keys(KIND_THEME_VARIABLES) as ThemedKind[];

const tokensSchema = z.record(z.string(), z.string());

export const kindThemeSchema = z.object({
  dark: tokensSchema,
  light: tokensSchema,
});
/** One kind's theme: custom property values for light and for dark. */
export type KindTheme = z.infer<typeof kindThemeSchema>;

/** Every themed kind's theme, as the runtime is handed it. */
export const kindThemesSchema = z.partialRecord(
  z.enum(THEMED_KINDS as [ThemedKind, ...ThemedKind[]]),
  kindThemeSchema
);
export type KindThemes = z.infer<typeof kindThemesSchema>;

export const EMPTY_THEME: KindTheme = { dark: {}, light: {} };

const COMMENT = /\/\*[\s\S]*?\*\//g;
const DECLARATION = /^\s*(--[a-z0-9-]+)\s*:\s*([^;]*?)\s*$/i;
/** What a value may not hold: no loading, no escaping the declaration. */
const UNSAFE_VALUE = /url\(|@import|expression\(|[<>{}\\]|\/\*/i;
const MAX_VALUE = 200;

const declarationsOf = (
  body: string,
  allowed: ReadonlySet<string>
): Record<string, string> => {
  const tokens: Record<string, string> = {};
  for (const line of body.split(";")) {
    const match = DECLARATION.exec(line);
    const name = match?.[1]?.toLowerCase();
    const value = match?.[2];
    if (
      name &&
      value &&
      allowed.has(name) &&
      value.length <= MAX_VALUE &&
      !UNSAFE_VALUE.test(value)
    ) {
      tokens[name] = value;
    }
  }
  return tokens;
};

/** The file's top-level rules; a nested one (inside `@media`) is never top level. */
const topLevelBlocks = (
  css: string
): { readonly body: string; readonly prelude: string }[] => {
  const blocks: { body: string; prelude: string }[] = [];
  let depth = 0;
  let start = 0;
  let open = 0;
  let nested = false;
  for (let index = 0; index < css.length; index += 1) {
    const char = css[index];
    if (char === "{") {
      if (depth === 0) {
        open = index;
        nested = false;
      } else {
        nested = true;
      }
      depth += 1;
    } else if (char === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0) {
        if (!nested) {
          blocks.push({
            body: css.slice(open + 1, index),
            // After any statement before it (`@charset "utf-8";`).
            prelude: (css.slice(start, open).split(";").pop() ?? "").trim(),
          });
        }
        start = index + 1;
      }
    }
  }
  return blocks;
};

/**
 * The values a theme file sets for `kind`: its `:root` and `.dark` blocks,
 * the declared variables only. Everything else is ignored. Pure.
 */
export const parseKindTheme = (css: string, kind: ThemedKind): KindTheme => {
  const allowed = new Set<string>(KIND_THEME_VARIABLES[kind]);
  const theme = { dark: {}, light: {} } as {
    dark: Record<string, string>;
    light: Record<string, string>;
  };
  for (const { body, prelude } of topLevelBlocks(css.replace(COMMENT, ""))) {
    if (prelude === ":root") {
      Object.assign(theme.light, declarationsOf(body, allowed));
    } else if (prelude === ".dark") {
      Object.assign(theme.dark, declarationsOf(body, allowed));
    }
  }
  return theme;
};

/** `over` on top of `under`, per mode: a kind's file over the shared one. Pure. */
export const layerThemes = (under: KindTheme, over: KindTheme): KindTheme => ({
  dark: { ...under.dark, ...over.dark },
  light: { ...under.light, ...over.light },
});

/**
 * A theme's declarations for one mode, as CSS to put after the defaults:
 * light is the file's `:root`, dark its `.dark`. Pure.
 */
export const themeDeclarations = (
  theme: KindTheme,
  mode: "dark" | "light"
): string =>
  Object.entries(theme[mode])
    .map(([name, value]) => `${name}: ${value};`)
    .join(" ");

const MAX_DESIGN = 8000;

/**
 * A kind's guide with the instance's house style (its DESIGN.md prose)
 * after it, or as it is without one. Pure.
 */
export const withHouseStyle = (
  instructions: string,
  design: string | undefined
): string => {
  const prose = design?.trim().slice(0, MAX_DESIGN);
  return prose
    ? `${instructions}\n\n### House style\n\nThis instance's own design notes. Follow them where they don't conflict with the rules above.\n\n${prose}`
    : instructions;
};
