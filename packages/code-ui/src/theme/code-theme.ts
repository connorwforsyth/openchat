import type { ThemeRegistration } from "@pierre/diffs";

// The Shiki theme for every code surface, generated from the `packages/ui`
// tokens (PLAN.md D5, D16). Colours are CSS expressions over the tokens, never
// literals: Shiki keeps non-hex colours as-is, so a highlighted span carries
// `var(--foreground)` and `shadcn apply` re-themes code without re-highlighting.
//
// The tokens flip light/dark on the `.dark` class, so both themes share one
// palette. They differ only in `type`, which @pierre/diffs uses to pick the
// light or dark branch of its own `light-dark()` fallbacks.

const token = (name: string): string => `var(--${name})`;

/**
 * A syntax colour: the hue of a chart token, pulled towards the foreground so
 * it keeps text contrast on either background. With the neutral preset the
 * chart tokens are greys and code reads as weighted greys; a coloured preset
 * brings its hues in.
 */
const tint = (name: string, weight = 55): string =>
  `color-mix(in oklab, ${token(name)} ${weight}%, ${token("foreground")})`;

/**
 * The diff colours. The theme has no success token yet, so additions read a
 * `--success` token when one exists and fall back to a chart hue until then.
 */
export const diffColors = {
  addition: `var(--success, ${token("chart-2")})`,
  deletion: token("destructive"),
  modified: token("ring"),
} as const;

/** Syntax roles and the token expression each one is drawn with. */
export const syntaxColors = {
  attribute: tint("chart-4"),
  background: token("background"),
  comment: token("muted-foreground"),
  constant: tint("chart-3"),
  foreground: token("foreground"),
  function: tint("chart-4", 65),
  invalid: token("destructive"),
  keyword: tint("chart-1", 65),
  punctuation: `color-mix(in oklab, ${token("muted-foreground")} 50%, ${token("foreground")})`,
  string: tint("chart-2"),
  tag: tint("chart-1"),
  type: tint("chart-5", 65),
} as const;

export type SyntaxRole = keyof typeof syntaxColors;

const scopes: Readonly<Record<Exclude<SyntaxRole, "background">, string[]>> = {
  attribute: ["entity.other.attribute-name", "support.type.property-name"],
  comment: ["comment", "punctuation.definition.comment"],
  constant: [
    "constant",
    "constant.numeric",
    "constant.language",
    "support.constant",
    "variable.other.enummember",
  ],
  foreground: ["variable", "variable.parameter", "meta.embedded"],
  function: ["entity.name.function", "support.function", "meta.function-call"],
  invalid: ["invalid", "invalid.illegal"],
  keyword: [
    "keyword",
    "storage",
    "storage.type",
    "storage.modifier",
    "keyword.control",
    "keyword.operator.new",
  ],
  punctuation: ["punctuation", "meta.brace", "keyword.operator"],
  string: [
    "string",
    "string.template",
    "markup.inline.raw",
    "markup.fenced_code",
  ],
  tag: ["entity.name.tag", "support.class.component"],
  type: [
    "entity.name.type",
    "entity.name.class",
    "support.type",
    "support.class",
    "entity.other.inherited-class",
  ],
};

/** The theme names registered with @pierre/diffs, by colour scheme. */
/**
 * Every code view on the main thread asks for Shiki's WASM (Oniguruma) engine
 * (143). @pierre/diffs keeps one highlighter per page, made with the engine of
 * whoever asks first, and the JavaScript regex engine can backtrack for
 * minutes on hostile input, which model output can be.
 */
export const preferredHighlighter = "shiki-wasm" as const;

export const codeThemeNames = {
  dark: "workspace-code-dark",
  light: "workspace-code-light",
} as const;

export type CodeThemeType = keyof typeof codeThemeNames;

/** Builds the Shiki theme for one colour scheme. Pure; registration is separate. */
export function createCodeTheme(type: CodeThemeType): ThemeRegistration {
  const tokenColors = Object.entries(scopes).map(([role, scope]) => ({
    scope,
    settings: {
      fontStyle: role === "comment" ? "italic" : undefined,
      foreground: syntaxColors[role as SyntaxRole],
    },
  }));

  return {
    bg: syntaxColors.background,
    colors: {
      "editor.background": syntaxColors.background,
      "editor.foreground": syntaxColors.foreground,
      "editor.selectionBackground": token("accent"),
      focusBorder: token("ring"),
      // Read by @pierre/diffs for its addition/deletion/modified colours and
      // by @pierre/trees for git-status decorations.
      "gitDecoration.addedResourceForeground": diffColors.addition,
      "gitDecoration.deletedResourceForeground": diffColors.deletion,
      "gitDecoration.modifiedResourceForeground": diffColors.modified,
      "input.background": token("background"),
      "input.border": token("input"),
      "list.activeSelectionBackground": token("sidebar-accent"),
      "list.activeSelectionForeground": token("sidebar-accent-foreground"),
      "list.hoverBackground": token("sidebar-accent"),
      "scrollbarSlider.background": token("border"),
      "sideBar.background": token("sidebar"),
      "sideBar.border": token("sidebar-border"),
      "sideBar.foreground": token("sidebar-foreground"),
      "sideBarSectionHeader.foreground": token("muted-foreground"),
      "terminal.ansiBlue": tint("chart-3"),
      "terminal.ansiCyan": tint("chart-4"),
      "terminal.ansiGreen": diffColors.addition,
      "terminal.ansiMagenta": tint("chart-5"),
      "terminal.ansiRed": diffColors.deletion,
      "terminal.ansiYellow": tint("chart-1"),
    },
    fg: syntaxColors.foreground,
    name: codeThemeNames[type],
    settings: [
      {
        settings: {
          background: syntaxColors.background,
          foreground: syntaxColors.foreground,
        },
      },
      ...tokenColors,
    ],
    type,
  };
}
