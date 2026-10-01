import { importSpecifiers } from "../../checks";
import { isExternal } from "./origins";

// What a site's files point at (125): the resources a page loads and the
// pages it links to, read from HTML, CSS and JavaScript. A scan, not a
// parse, like `importSpecifiers`: it finds what a browser would fetch in
// ordinary markup, and the CSP catches whatever it misses.

/** A URL a file names, and whether loading the page fetches it. */
export interface SiteReference {
  /** `resource`: fetched to show the page; `link`: only if someone follows it. */
  readonly kind: "link" | "resource";
  readonly url: string;
}

/** The scripts and styles written inside a page, to scan as their language. */
export interface InlineCode {
  readonly scripts: readonly string[];
  readonly styles: readonly string[];
}

const TAG = /<([a-zA-Z][a-zA-Z0-9-]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
const ATTRIBUTE =
  /([a-zA-Z_:][a-zA-Z0-9_:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
const SCRIPT_BODY = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const STYLE_BODY = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;
const HAS_SRC = /\bsrc\s*=/i;
const COMMENT = /<!--[\s\S]*?-->/g;
const CSS_COMMENT = /\/\*[\s\S]*?\*\//g;
const CSS_URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/gi;
const CSS_IMPORT = /@import\s+(?:"([^"]*)"|'([^']*)')/gi;
const SRCSET_ENTRY = /\s+\d+(?:\.\d+)?[wx]$/;

/** Attributes that load something when the page renders, by tag. */
const RESOURCE_ATTRIBUTES: Readonly<Record<string, readonly string[]>> = {
  audio: ["src"],
  embed: ["src"],
  iframe: ["src"],
  img: ["src", "srcset"],
  input: ["src"],
  link: ["href"],
  object: ["data"],
  script: ["src"],
  source: ["src", "srcset"],
  track: ["src"],
  use: ["href", "xlink:href"],
  video: ["src", "poster"],
};

/** Attributes that only point somewhere. */
const LINK_ATTRIBUTES: Readonly<Record<string, readonly string[]>> = {
  a: ["href"],
  area: ["href"],
  form: ["action"],
};

const decodeEntities = (value: string): string =>
  value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");

const attributesOf = (source: string): ReadonlyMap<string, string> =>
  new Map(
    [...source.matchAll(ATTRIBUTE)].map((match) => [
      (match[1] ?? "").toLowerCase(),
      decodeEntities(match[2] ?? match[3] ?? match[4] ?? ""),
    ])
  );

const srcsetUrls = (value: string): readonly string[] =>
  value
    .split(",")
    .map((entry) => entry.trim().replace(SRCSET_ENTRY, ""))
    .filter(Boolean);

/** The URLs a stylesheet loads: `url(…)` and `@import`. */
export const cssReferences = (css: string): readonly SiteReference[] => {
  const text = css.replace(CSS_COMMENT, "");
  return [...text.matchAll(CSS_IMPORT), ...text.matchAll(CSS_URL)]
    .map((match) => match[1] ?? match[2] ?? match[3] ?? "")
    .filter((url) => url !== "")
    .map((url) => ({ kind: "resource", url }));
};

/** The modules a script imports, as resources. */
export const scriptReferences = (js: string): readonly SiteReference[] =>
  importSpecifiers(js).map((url) => ({ kind: "resource", url }));

/** The `<script>` and `<style>` bodies written inside a page. */
export const inlineCode = (html: string): InlineCode => {
  const text = html.replace(COMMENT, "");
  return {
    scripts: [...text.matchAll(SCRIPT_BODY)]
      .filter((match) => !HAS_SRC.test(match[1] ?? ""))
      .map((match) => match[2] ?? ""),
    styles: [
      ...[...text.matchAll(STYLE_BODY)].map((match) => match[1] ?? ""),
      // `style="…"` attributes are CSS too.
      ...[...text.matchAll(TAG)].flatMap((match) => {
        const style = attributesOf(match[2] ?? "").get("style");
        return style ? [style] : [];
      }),
    ],
  };
};

/**
 * Everything a page refers to: its tags' resources and links, and what its
 * inline styles and scripts load.
 */
export const htmlReferences = (html: string): readonly SiteReference[] => {
  const text = html.replace(COMMENT, "");
  const fromTags = [...text.matchAll(TAG)].flatMap(
    (match): readonly SiteReference[] => {
      const tag = (match[1] ?? "").toLowerCase();
      const attributes = attributesOf(match[2] ?? "");
      const read = (
        names: readonly string[] | undefined,
        kind: SiteReference["kind"]
      ) =>
        (names ?? []).flatMap((name) => {
          const value = attributes.get(name);
          if (value === undefined || value.trim() === "") {
            return [];
          }
          const urls = name === "srcset" ? srcsetUrls(value) : [value.trim()];
          return urls.map((url) => ({ kind, url }));
        });
      return [
        ...read(RESOURCE_ATTRIBUTES[tag], "resource"),
        ...read(LINK_ATTRIBUTES[tag], "link"),
      ];
    }
  );
  const { scripts, styles } = inlineCode(html);
  return [
    ...fromTags,
    ...styles.flatMap(cssReferences),
    ...scripts.flatMap(scriptReferences),
  ];
};

/** What `path` refers to, by its type; nothing for types that refer to nothing. */
export const fileReferences = (
  path: string,
  text: string
): readonly SiteReference[] => {
  const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  switch (extension) {
    case "html":
      return htmlReferences(text);
    case "css":
      return cssReferences(text);
    case "js":
    case "mjs":
      return scriptReferences(text);
    default:
      return [];
  }
};

const NOT_A_FILE = /^(?:#|data:|blob:|mailto:|tel:|sms:|javascript:|about:)/i;
const QUERY_OR_FRAGMENT = /[?#].*$/;

/**
 * Where a relative `url` in `from` points inside the site: a path, `null`
 * for something that isn't a file in it (an anchor, a `data:` URL, an
 * external URL), or `root` for a `/`-rooted path, which a published site's
 * link (`/s/<token>/…`) would break.
 */
export const resolveInSite = (
  from: string,
  url: string
): string | "root" | null => {
  const trimmed = url.trim();
  if (trimmed === "" || NOT_A_FILE.test(trimmed) || isExternal(trimmed)) {
    return null;
  }
  if (trimmed.startsWith("/")) {
    return "root";
  }
  const bare = trimmed.replace(QUERY_OR_FRAGMENT, "");
  if (bare === "") {
    return null;
  }
  const parts = from.split("/").slice(0, -1);
  for (const segment of bare.split("/")) {
    if (segment === "..") {
      parts.pop();
    } else if (segment !== "." && segment !== "") {
      parts.push(segment);
    }
  }
  const resolved = parts.join("/");
  // A folder link means its index page, as a static host serves it.
  return bare.endsWith("/") || resolved === ""
    ? [resolved, "index.html"].filter(Boolean).join("/")
    : resolved;
};
