import { extensionOf, type SiteContent } from "./content";
import { resolveInSite } from "./scan";
import { siteTailwindInput } from "./theme";

// Building an html-tailwind site (125): Tailwind is compiled for the classes
// the site uses, over the instance's theme, and put in each page. The
// compiler is a port: the artifact runtime passes Tailwind's, in the browser
// for a preview and on its server for a published link, so the kit ships
// none and stays pure.

/** Compiles Tailwind `input` (CSS) for `candidates` (class names) to CSS. */
export type CompileTailwind = (
  input: string,
  candidates: readonly string[]
) => Promise<string>;

export interface SiteBuildPorts {
  readonly compile: CompileTailwind;
  /** The instance's theme, `globals.css` as text (`./theme.ts`). */
  readonly themeCss: string;
}

/** Where a built page will be shown, which decides what it may refer to. */
export type SiteBuildTarget =
  /**
   * A preview: one page at a time in a `srcdoc` frame, which can't fetch
   * the site's other files, so local stylesheets, scripts and SVG images are
   * written into the page, and following a link to another page asks the
   * runtime (`SITE_PREVIEW_CHANNEL`) to show that one.
   */
  | "preview"
  /** A published link: every file is served at its path, so pages stay as written. */
  | "published";

export interface BuiltSite {
  /** The CSS every page got. */
  readonly css: string;
  /** Every file: pages with the CSS (and, for a preview, more) built in. */
  readonly files: Readonly<Record<string, string>>;
}

/** Messages a previewed page posts to the runtime, on this channel. */
export const SITE_PREVIEW_CHANNEL = "site-preview/1";

const CANDIDATE_SPLIT = /[\s"'`<>]+/;

/** The words a site's pages and scripts use, which Tailwind turns into classes. */
export const tailwindCandidates = (
  files: Readonly<Record<string, string>>
): readonly string[] => [
  ...new Set(
    Object.entries(files)
      .filter(([path]) => ["html", "js", "mjs"].includes(extensionOf(path)))
      .flatMap(([, text]) => text.split(CANDIDATE_SPLIT))
      .filter((word) => word.length > 0 && word.length < 200)
  ),
];

const HEAD_OPEN = /<head\b[^>]*>/i;
const HTML_OPEN = /<html\b[^>]*>/i;
const DOCTYPE = /^\s*<!doctype[^>]*>/i;

/** `markup` placed at the start of the page's head (or as near as it has). */
export const intoHead = (page: string, markup: string): string => {
  for (const pattern of [HEAD_OPEN, HTML_OPEN, DOCTYPE]) {
    const match = pattern.exec(page);
    if (match) {
      const at = match.index + match[0].length;
      return `${page.slice(0, at)}${markup}${page.slice(at)}`;
    }
  }
  return `${markup}${page}`;
};

/** Text that can sit inside `<style>` or `<script>` without closing it. */
const raw = (text: string, tag: "script" | "style") =>
  text.replace(new RegExp(`</(${tag})`, "gi"), "<\\/$1");

const STYLESHEET_LINK = /<link\b(?=[^>]*\brel\s*=\s*["']?stylesheet)[^>]*>/gi;
const SCRIPT_WITH_SRC =
  /<script\b([^>]*)\bsrc\s*=\s*(["'])([^"']*)\2([^>]*)>\s*<\/script\s*>/gi;
const IMG_SRC = /(<img\b[^>]*\bsrc\s*=\s*)(["'])([^"']*)\2/gi;
const QUERY_OR_FRAGMENT = /[?#].*$/;
const HREF = /\bhref\s*=\s*(["'])([^"']*)\1/i;

const toBase64 = (text: string): string => {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
};

/** A previewed page with the site's own files written in. */
const inlineLocalFiles = (
  path: string,
  page: string,
  files: Readonly<Record<string, string>>
): string => {
  const local = (url: string) => {
    const target = resolveInSite(path, url);
    return target && target !== "root" ? files[target] : undefined;
  };
  return page
    .replace(STYLESHEET_LINK, (tag) => {
      const href = HREF.exec(tag)?.[2];
      const css = href === undefined ? undefined : local(href);
      return css === undefined ? tag : `<style>${raw(css, "style")}</style>`;
    })
    .replace(
      SCRIPT_WITH_SRC,
      (tag, before: string, _q, src: string, after: string) => {
        const js = local(src);
        return js === undefined
          ? tag
          : `<script${before}${after}>${raw(js, "script")}</script>`;
      }
    )
    .replace(IMG_SRC, (tag, start: string, quote: string, src: string) => {
      const svg =
        extensionOf(src.replace(QUERY_OR_FRAGMENT, "")) === "svg"
          ? local(src)
          : undefined;
      return svg === undefined
        ? tag
        : `${start}${quote}data:image/svg+xml;base64,${toBase64(svg)}${quote}`;
    });
};

/**
 * Following a link to another page of the site asks the runtime to show
 * it; everything else (anchors, other sites) behaves as it would.
 */
const previewNavigation = (path: string, pages: readonly string[]) =>
  `<script>(() => {
  const page = ${JSON.stringify(path)};
  const pages = new Set(${JSON.stringify(pages)});
  const resolve = (href) => {
    if (/^(?:[a-z][a-z0-9+.-]*:|\\/\\/|#)/i.test(href)) return null;
    const parts = page.split("/").slice(0, -1);
    for (const part of href.replace(/[?#].*$/, "").split("/")) {
      if (part === "..") parts.pop(); else if (part && part !== ".") parts.push(part);
    }
    const target = href.replace(/[?#].*$/, "").endsWith("/") || parts.length === 0
      ? [...parts, "index.html"].join("/") : parts.join("/");
    return pages.has(target) ? target : null;
  };
  document.addEventListener("click", (event) => {
    const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
    const target = link ? resolve(link.getAttribute("href") || "") : null;
    if (target) {
      event.preventDefault();
      parent.postMessage({ channel: ${JSON.stringify(SITE_PREVIEW_CHANNEL)}, page: target, type: "navigate" }, "*");
    }
  });
})();</script>`;

/**
 * The site, built: Tailwind compiled once for every class it uses, and put
 * at the top of each page's head. For a preview, each page also carries its
 * local files and the link handling above.
 */
export const buildSite = async (
  content: SiteContent,
  { compile, themeCss }: SiteBuildPorts,
  target: SiteBuildTarget
): Promise<BuiltSite> => {
  const css = await compile(
    siteTailwindInput(themeCss),
    tailwindCandidates(content.files)
  );
  const pages = Object.keys(content.files).filter(
    (path) => extensionOf(path) === "html"
  );
  const style = `<style data-site-theme>${raw(css, "style")}</style>`;
  const files = Object.fromEntries(
    Object.entries(content.files).map(([path, text]) => {
      if (extensionOf(path) !== "html") {
        return [path, text];
      }
      if (target === "published") {
        return [path, intoHead(text, style)];
      }
      return [
        path,
        intoHead(
          inlineLocalFiles(path, text, content.files),
          `${style}${previewNavigation(path, pages)}`
        ),
      ];
    })
  );
  return { css, files };
};
