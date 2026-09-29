import type { SandboxFileEncoding } from "@workspace/contract/schemas/sandbox";
import type { AsyncResult } from "@workspace/shared/result";
import { z } from "zod";

// A workspace with no ports (just-bash) can't serve its pages, so the
// browser renders the HTML file itself in a sandboxed `srcdoc` frame (066).
// That frame has no origin to load `style.css` from, so the page's own
// stylesheets, scripts and images are read from the workspace and inlined,
// up to a size cap. Links to other pages are handed to the panel, which
// renders those the same way. Anything else (fetches, relative imports from
// module scripts) doesn't work: it's a static render, and labelled as one.

/** How much a render may inline, the page included. */
export const STATIC_RENDER_MAX_BYTES = 2 * 1024 * 1024;

export interface StaticFile {
  readonly content: string;
  readonly encoding: SandboxFileEncoding;
}

/** Reads a workspace file by its path relative to the workspace (`css/a.css`). */
export type ReadStaticFile = (path: string) => AsyncResult<StaticFile, string>;

export interface StaticRender {
  readonly html: string;
  /** Files the page refers to that weren't inlined: missing, or over the cap. */
  readonly skipped: readonly string[];
}

/** What the render's link script posts to the panel. */
export const staticLinkMessageSchema = z.object({
  href: z.string(),
  type: z.literal("workspace-preview-link"),
});

const PLACEHOLDER_ORIGIN = "http://workspace.invalid";
const LEADING_SLASHES = /^\/+/;

/**
 * The workspace path `ref` points to from the page at `from` (a workspace
 * path too), or `null` for anything that isn't a workspace file: other
 * origins, `data:` URLs, fragments.
 */
export const workspaceRef = (from: string, ref: string): string | null => {
  const text = ref.trim();
  if (text === "" || text.startsWith("#")) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(text, `${PLACEHOLDER_ORIGIN}/${from}`);
  } catch {
    return null;
  }
  if (url.origin !== PLACEHOLDER_ORIGIN) {
    return null;
  }
  try {
    return (
      decodeURIComponent(url.pathname).replace(LEADING_SLASHES, "") || null
    );
  } catch {
    return null;
  }
};

const MIME: Readonly<Record<string, string>> = {
  avif: "image/avif",
  bmp: "image/bmp",
  gif: "image/gif",
  ico: "image/x-icon",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  webp: "image/webp",
};

const mimeOf = (path: string): string =>
  MIME[path.slice(path.lastIndexOf(".") + 1).toLowerCase()] ??
  "application/octet-stream";

const base64OfText = (text: string): string => {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
};

const textOf = (file: StaticFile): string => {
  if (file.encoding === "utf8") {
    return file.content;
  }
  const binary = atob(file.content);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
};

const dataUrlOf = (path: string, file: StaticFile): string =>
  `data:${mimeOf(path)};base64,${
    file.encoding === "base64" ? file.content : base64OfText(file.content)
  }`;

// Inlined text can't close its own element early.
const inlineScript = (text: string) =>
  text.replaceAll(/<\/script/gi, "<\\/script");
const inlineStyle = (text: string) =>
  text.replaceAll(/<\/style/gi, "<\\/style");

/**
 * Links to other pages post their `href` to the panel instead of
 * navigating: a `srcdoc` frame's relative links lead nowhere.
 */
const LINK_SCRIPT = `(function(){document.addEventListener("click",function(e){var a=e.target&&e.target.closest?e.target.closest("a[href]"):null;if(!a||a.target==="_blank"||e.defaultPrevented)return;var h=a.getAttribute("href")||"";if(h===""||h.charAt(0)==="#"||/^[a-z][a-z0-9+.-]*:/i.test(h)||h.slice(0,2)==="//")return;e.preventDefault();parent.postMessage({type:"workspace-preview-link",href:h},"*")},true)})()`;

interface Budget {
  left: number;
}

/** A size that counts UTF-16 code units: close enough for a cap. */
const sizeOf = (text: string) => text.length;

/**
 * The page at `path` with its local stylesheets, scripts and images inlined,
 * ready for a sandboxed frame's `srcdoc`.
 */
export const renderStaticPage = async ({
  html,
  maxBytes = STATIC_RENDER_MAX_BYTES,
  path,
  read,
}: {
  readonly html: string;
  readonly maxBytes?: number;
  readonly path: string;
  readonly read: ReadStaticFile;
}): Promise<StaticRender> => {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const budget: Budget = { left: maxBytes - sizeOf(html) };
  const skipped: string[] = [];

  const fetchInto = async (
    ref: string | null,
    use: (file: StaticFile, target: string) => string | null
  ): Promise<void> => {
    const target = ref === null ? null : workspaceRef(path, ref);
    if (target === null) {
      return;
    }
    const got = await read(target);
    const inlined = got.ok ? use(got.value, target) : null;
    if (inlined === null) {
      skipped.push(target);
    }
  };

  // In document order, one at a time, so the cap keeps what comes first.
  const jobs: (() => Promise<void>)[] = [];
  for (const link of doc.querySelectorAll<HTMLLinkElement>(
    "link[rel~=stylesheet][href]"
  )) {
    jobs.push(() =>
      fetchInto(link.getAttribute("href"), (file) => {
        const css = textOf(file);
        if (sizeOf(css) > budget.left) {
          return null;
        }
        budget.left -= sizeOf(css);
        const style = doc.createElement("style");
        style.textContent = inlineStyle(css);
        const media = link.getAttribute("media");
        if (media) {
          style.setAttribute("media", media);
        }
        link.replaceWith(style);
        return css;
      })
    );
  }
  for (const script of doc.querySelectorAll<HTMLScriptElement>("script[src]")) {
    jobs.push(() =>
      fetchInto(script.getAttribute("src"), (file) => {
        const js = textOf(file);
        if (sizeOf(js) > budget.left) {
          return null;
        }
        budget.left -= sizeOf(js);
        script.removeAttribute("src");
        script.textContent = inlineScript(js);
        return js;
      })
    );
  }
  for (const image of doc.querySelectorAll<HTMLImageElement>("img[src]")) {
    jobs.push(() =>
      fetchInto(image.getAttribute("src"), (file, target) => {
        const url = dataUrlOf(target, file);
        if (sizeOf(url) > budget.left) {
          return null;
        }
        budget.left -= sizeOf(url);
        image.setAttribute("src", url);
        return url;
      })
    );
  }
  for (const job of jobs) {
    // biome-ignore lint/performance/noAwaitInLoops: in order, so the cap keeps what comes first.
    await job();
  }

  const links = doc.createElement("script");
  links.textContent = LINK_SCRIPT;
  (doc.head ?? doc.documentElement).prepend(links);

  return {
    html: `<!doctype html>\n${doc.documentElement.outerHTML}`,
    skipped,
  };
};
