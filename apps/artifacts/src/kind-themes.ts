import {
  EMPTY_THEME,
  type KindTheme,
  type KindThemes,
  kindThemesSchema,
  layerThemes,
  parseKindTheme,
  THEMED_KINDS,
} from "@workspace/artifacts-kit/kind-theme";

// The instance's per-kind themes (n2), from its brand folder
// (`ARTIFACTS_BRAND_DIR`): `theme.css` for every kind, then
// `kinds/<kind>/theme.css`. The server reads them per request, so editing
// a file needs no restart, and hands them to the page as JSON in a
// non-executing script tag; the page applies them over the app theme.
// Only this runtime reads them: they're never in a model's context.

const ELEMENT_ID = "kind-themes";

/** Reads a file's text, or `null` if it isn't there. A port, for tests. */
export type ReadText = (path: string) => Promise<string | null>;

/** Every themed kind's theme from the brand folder `dir`. */
export const readKindThemes = async (
  dir: string | null,
  read: ReadText
): Promise<KindThemes> => {
  if (dir === null) {
    return {};
  }
  const shared = (await read(`${dir}/theme.css`)) ?? "";
  const entries = await Promise.all(
    THEMED_KINDS.map(async (kind) => {
      const own = (await read(`${dir}/kinds/${kind}/theme.css`)) ?? "";
      const theme = layerThemes(
        parseKindTheme(shared, kind),
        parseKindTheme(own, kind)
      );
      const empty =
        Object.keys(theme.light).length + Object.keys(theme.dark).length === 0;
      return empty ? [] : [[kind, theme] as const];
    })
  );
  return Object.fromEntries(entries.flat());
};

/** `html` with `themes` in its head, for the page to read. Pure. */
export const withKindThemes = (html: string, themes: KindThemes): string => {
  if (Object.keys(themes).length === 0) {
    return html;
  }
  // `<` escaped, so nothing in a value can close the tag.
  const json = JSON.stringify(themes).replaceAll("<", "\\u003c");
  return html.replace(
    "</head>",
    `<script id="${ELEMENT_ID}" type="application/json">${json}</script></head>`
  );
};

/** The themes the server put in this page; none if it put none. */
export const pageKindThemes = (doc: Document): KindThemes => {
  const text = doc.getElementById(ELEMENT_ID)?.textContent;
  if (!text) {
    return {};
  }
  try {
    const parsed = kindThemesSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
};

/** One kind's theme, or the empty one. Pure. */
export const themeOf = (
  themes: KindThemes,
  kind: keyof KindThemes
): KindTheme => themes[kind] ?? EMPTY_THEME;
