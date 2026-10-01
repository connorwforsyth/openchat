import { LINK_PREVIEW_LIMITS } from "@workspace/contract/schemas/link-preview";

// Reads a page's preview out of its `<head>` (101): `og:*`, then
// `twitter:*`, then `<title>` and `<meta name=description>`, plus the best
// raster favicon. A small hand-written tokenizer rather than an HTML parser
// dependency: only `<title>`, `<meta>`, `<link>` and `<base>` matter, it
// stops at `</head>` or `<body>`, and it skips comments, scripts and styles
// so text inside them can't pose as tags. Pure.

export interface HeadPreview {
  readonly description?: string;
  /** Absolute http(s) URL of the chosen favicon (or `/favicon.ico`). */
  readonly icon?: string;
  readonly image?: {
    readonly alt?: string;
    readonly height?: number;
    readonly url: string;
    readonly width?: number;
  };
  readonly siteName?: string;
  readonly title?: string;
}

// --- bytes to text ---

const META_CHARSET = /<meta[^>]+charset\s*=\s*["']?\s*([\w-]+)/i;

/** Decodes with the header's charset, else the page's `<meta>`, else UTF-8. */
export const decodeHtml = (
  bytes: Uint8Array,
  headerCharset: string | null
): string => {
  const sniffed = META_CHARSET.exec(
    Buffer.from(bytes.subarray(0, 4096)).toString("latin1")
  )?.[1];
  for (const label of [headerCharset, sniffed]) {
    if (!label) {
      continue;
    }
    try {
      return new TextDecoder(label).decode(bytes);
    } catch {
      // Unknown label: try the next.
    }
  }
  return new TextDecoder("utf-8").decode(bytes);
};

// --- text clean-up ---

const NAMED: Readonly<Record<string, string>> = {
  amp: "&",
  apos: "'",
  bull: "•",
  copy: "©",
  gt: ">",
  hellip: "…",
  laquo: "«",
  ldquo: "“",
  lsquo: "‘",
  lt: "<",
  mdash: "—",
  middot: "·",
  nbsp: " ",
  ndash: "–",
  quot: '"',
  raquo: "»",
  rdquo: "”",
  reg: "®",
  rsquo: "’",
  trade: "™",
};

const ENTITY = /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi;

const decodeEntities = (text: string) =>
  text.replace(ENTITY, (whole, body: string) => {
    if (body.startsWith("#")) {
      const code =
        body[1] === "x" || body[1] === "X"
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      return code > 0 &&
        code <= 0x10_ff_ff &&
        !(code >= 0xd8_00 && code <= 0xdf_ff)
        ? String.fromCodePoint(code)
        : "";
    }
    return NAMED[body.toLowerCase()] ?? whole;
  });

const TAGS = /<[^>]*>/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
const CONTROL = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮]/g;
const SPACES = /\s+/g;
const HIGH_SURROGATE = /[\ud800-\udbff]/;

/** Plain text, at most `max` characters. */
const cleanText = (raw: string | undefined, max: number) => {
  if (raw === undefined) {
    return;
  }
  const text = decodeEntities(raw.replace(TAGS, " "))
    .replace(TAGS, " ")
    .replace(CONTROL, " ")
    .replace(SPACES, " ")
    .trim();
  if (text === "") {
    return;
  }
  if (text.length <= max) {
    return text;
  }
  // The contract caps UTF-16 length; don't split a surrogate pair.
  let cut = text.slice(0, max - 1);
  if (HIGH_SURROGATE.test(cut.at(-1) ?? "")) {
    cut = cut.slice(0, -1);
  }
  return `${cut.trimEnd()}…`;
};

// --- the tokenizer ---

interface Tag {
  readonly attributes: ReadonlyMap<string, string>;
  readonly name: string;
}

const ATTRIBUTE =
  /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

const parseAttributes = (source: string): ReadonlyMap<string, string> => {
  const attributes = new Map<string, string>();
  for (const match of source.matchAll(ATTRIBUTE)) {
    const name = (match[1] ?? "").toLowerCase();
    if (!attributes.has(name)) {
      attributes.set(name, match[2] ?? match[3] ?? match[4] ?? "");
    }
  }
  return attributes;
};

/** The index just past the `>` that closes the tag at `start`, quotes respected. */
const tagEnd = (html: string, start: number): number => {
  let quote: string | null = null;
  for (let index = start; index < html.length; index += 1) {
    const char = html[index];
    if (quote) {
      if (char === quote) {
        quote = null;
      }
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === ">") {
      return index + 1;
    }
  }
  return -1;
};

const TAG_NAME = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)/;
const RAW_TEXT = new Set(["script", "style", "template", "noscript", "title"]);

type Token =
  | { readonly kind: "end" }
  | { readonly kind: "skip"; readonly next: number }
  | {
      readonly kind: "raw";
      readonly name: string;
      readonly next: number;
      readonly text: string;
    }
  | {
      readonly inner: string;
      readonly kind: "tag";
      readonly name: string;
      readonly next: number;
    };

const comment = (html: string, open: number): Token => {
  const close = html.indexOf("-->", open + 4);
  return close === -1 ? { kind: "end" } : { kind: "skip", next: close + 3 };
};

/** The token starting at the first `<` from `index`. */
const nextToken = (html: string, lower: string, index: number): Token => {
  const open = html.indexOf("<", index);
  if (open === -1) {
    return { kind: "end" };
  }
  if (html.startsWith("<!--", open)) {
    return comment(html, open);
  }
  const match = TAG_NAME.exec(html.slice(open, open + 64));
  if (!match) {
    return { kind: "skip", next: open + 1 };
  }
  const closing = match[1] === "/";
  const name = (match[2] ?? "").toLowerCase();
  const end = tagEnd(html, open + match[0].length);
  if (
    end === -1 ||
    (closing && name === "head") ||
    (!closing && name === "body")
  ) {
    return { kind: "end" };
  }
  if (closing) {
    return { kind: "skip", next: end };
  }
  if (RAW_TEXT.has(name)) {
    const close = lower.indexOf(`</${name}`, end);
    const stop = close === -1 ? html.length : close;
    return { kind: "raw", name, next: stop, text: html.slice(end, stop) };
  }
  const inner = html.slice(open + match[0].length, end - 1);
  return { inner, kind: "tag", name, next: end };
};

const HEAD_TAGS = new Set(["base", "link", "meta"]);

/** Head tags in order, with `<title>`'s text; stops at the body. */
const headTags = (html: string): { tags: Tag[]; title?: string } => {
  const tags: Tag[] = [];
  let title: string | undefined;
  const lower = html.toLowerCase();
  let token = nextToken(html, lower, 0);
  while (token.kind !== "end") {
    if (token.kind === "raw" && token.name === "title") {
      title ??= token.text;
    } else if (token.kind === "tag" && HEAD_TAGS.has(token.name)) {
      tags.push({
        attributes: parseAttributes(token.inner),
        name: token.name,
      });
    }
    token = nextToken(html, lower, token.next);
  }
  return { tags, title };
};

// --- choosing ---

const resolveHttp = (
  href: string | undefined,
  base: URL
): string | undefined => {
  const trimmed = href?.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    const url = new URL(decodeEntities(trimmed), base);
    const http = url.protocol === "http:" || url.protocol === "https:";
    // Longer ones wouldn't fit a signed image path.
    return http && url.href.length <= LINK_PREVIEW_LIMITS.url
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
};

const dimension = (raw: string | undefined) => {
  const value = Number(raw?.trim());
  return Number.isInteger(value) && value > 0 && value <= 20_000
    ? value
    : undefined;
};

const ICON_RELS = new Set([
  "apple-touch-icon",
  "apple-touch-icon-precomposed",
  "icon",
]);
const SIZE = /^(\d+)x(\d+)$/i;
const SVG = /\.svg(?:[?#]|$)/i;
/** What a 16px icon wants on a 2x screen. */
const IDEAL_ICON = 32;
const APPLE_TOUCH_SIZE = 180;

interface IconCandidate {
  readonly href: string;
  readonly size: number | null;
}

const iconCandidates = (tags: readonly Tag[], base: URL): IconCandidate[] =>
  tags.flatMap((tag) => {
    if (tag.name !== "link") {
      return [];
    }
    const rels = (tag.attributes.get("rel") ?? "").toLowerCase().split(SPACES);
    const rel = rels.find((word) => ICON_RELS.has(word));
    const href = resolveHttp(tag.attributes.get("href"), base);
    const type = (tag.attributes.get("type") ?? "").toLowerCase();
    // SVG is never served (it can carry script), so don't pick one.
    if (!(rel && href) || type.includes("svg") || SVG.test(href)) {
      return [];
    }
    const sizes = (tag.attributes.get("sizes") ?? "")
      .split(SPACES)
      .map((entry) => SIZE.exec(entry))
      .map((match) =>
        match ? Math.max(Number(match[1]), Number(match[2])) : 0
      )
      .filter((side) => side > 0);
    return [{ href, size: iconSize(sizes, rel) }];
  });

/** Its largest declared size; an undeclared apple-touch-icon is 180px. */
const iconSize = (sizes: readonly number[], rel: string): number | null => {
  if (sizes.length > 0) {
    return Math.max(...sizes);
  }
  return rel.startsWith("apple-touch-icon") ? APPLE_TOUCH_SIZE : null;
};

/** The smallest icon of at least 32px, else the largest, else any. */
const bestIcon = (candidates: readonly IconCandidate[]): string | undefined => {
  const sized = candidates.filter(
    (candidate): candidate is IconCandidate & { size: number } =>
      candidate.size !== null
  );
  const bigEnough = sized
    .filter(({ size }) => size >= IDEAL_ICON)
    .sort((a, b) => a.size - b.size);
  const unsized = candidates.find(({ size }) => size === null);
  const [largest] = [...sized].sort((a, b) => b.size - a.size);
  const [smallestBigEnough] = bigEnough;
  return (smallestBigEnough ?? unsized ?? largest)?.href;
};

const withoutUndefined = <T extends object>(value: T): T =>
  Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  ) as T;

/** The preview a page's `<head>` describes, URLs absolute against `pageUrl`. */
export const parseHead = (html: string, pageUrl: URL): HeadPreview => {
  const { tags, title } = headTags(html);
  const baseHref = tags
    .find((tag) => tag.name === "base")
    ?.attributes.get("href");
  const resolvedBase = resolveHttp(baseHref, pageUrl);
  const base = resolvedBase ? new URL(resolvedBase) : pageUrl;

  const meta = new Map<string, string>();
  for (const tag of tags) {
    if (tag.name !== "meta") {
      continue;
    }
    const key = (
      tag.attributes.get("property") ??
      tag.attributes.get("name") ??
      ""
    )
      .trim()
      .toLowerCase();
    const content = tag.attributes.get("content");
    if (key && content !== undefined && !meta.has(key)) {
      meta.set(key, content);
    }
  }
  const first = (...keys: string[]) =>
    keys.map((key) => meta.get(key)).find((value) => value?.trim());

  const imageUrl = resolveHttp(
    first(
      "og:image:secure_url",
      "og:image:url",
      "og:image",
      "twitter:image",
      "twitter:image:src"
    ),
    base
  );
  const image = imageUrl
    ? withoutUndefined({
        alt: cleanText(
          first("og:image:alt", "twitter:image:alt"),
          LINK_PREVIEW_LIMITS.alt
        ),
        height: dimension(meta.get("og:image:height")),
        url: imageUrl,
        width: dimension(meta.get("og:image:width")),
      })
    : undefined;

  return withoutUndefined({
    description: cleanText(
      first("og:description", "twitter:description", "description"),
      LINK_PREVIEW_LIMITS.description
    ),
    icon:
      bestIcon(iconCandidates(tags, base)) ??
      new URL("/favicon.ico", pageUrl).href,
    image,
    siteName: cleanText(
      first("og:site_name", "application-name"),
      LINK_PREVIEW_LIMITS.siteName
    ),
    title: cleanText(
      first("og:title", "twitter:title") ?? title,
      LINK_PREVIEW_LIMITS.title
    ),
  });
};
