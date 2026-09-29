import type {
  SandboxProvider,
  SandboxRecord,
} from "@workspace/contract/schemas/sandbox";
import { z } from "zod";

// The Workspace panel's built-in browser (066) as data: which page it shows,
// where that page is served from, and its own back/forward history. A
// preview is cross-origin (D24), so the panel can never read where the frame
// went; the address bar is what the panel navigated to, not what the frame
// reports. Pure, so the rules are tested without rendering.

/**
 * The port the server's built-in static file server listens on (067).
 * TODO(067): import the constant from `@workspace/sandbox` once 067 merges.
 */
export const STATIC_PREVIEW_PORT = 4173;

export type SandboxPreview = SandboxRecord["previews"][number];

/** What the browser can show pages from. */
export interface PreviewSources {
  /** The workspace's `.html` files, relative (`index.html`, `docs/a.html`). */
  readonly htmlPaths: readonly string[];
  readonly previews: readonly SandboxPreview[];
  /** `null` before the workspace exists. */
  readonly provider: SandboxProvider | null;
}

export const NO_SOURCES: PreviewSources = {
  htmlPaths: [],
  previews: [],
  provider: null,
};

/**
 * A page in the browser's history. `path` is the address bar's text: a path
 * on the preview's origin (`/about.html?x=1`). `port` pins a server; `null`
 * lets the rules below pick where the page comes from each time it shows,
 * so a static-files preview recorded a moment after the file was written is
 * used as soon as it's there.
 */
export const browserPageSchema = z.object({
  path: z.string().startsWith("/"),
  port: z.int().min(1).max(65_535).nullable(),
});
export type BrowserPage = z.infer<typeof browserPageSchema>;

/** Where a page is served from. */
export type PageTarget =
  | { readonly kind: "server"; readonly preview: SandboxPreview }
  /** No server: the HTML file itself, rendered in a `srcdoc` frame. */
  | { readonly kind: "static-render" };

const HTML = /\.html?$/i;
const MARKDOWN = /\.(?:md|markdown)$/i;
const QUERY_OR_HASH = /[?#].*$/;
const LEADING_SLASHES = /^\/+/;

export const isHtmlPath = (path: string): boolean =>
  HTML.test(path.replace(QUERY_OR_HASH, ""));
export const isMarkdownPath = (path: string): boolean => MARKDOWN.test(path);

/** The page path of a workspace file: `docs/a.html` → `/docs/a.html`. */
export const pagePathOf = (workspacePath: string): string =>
  `/${workspacePath.replace(LEADING_SLASHES, "")}`;

/**
 * The workspace file a page path names, as a static file server would:
 * `/` and `/docs/` are their `index.html`; the query and hash don't count.
 */
export const workspaceFileOf = (pagePath: string): string => {
  const bare = pagePath.replace(QUERY_OR_HASH, "");
  let decoded = bare;
  try {
    decoded = decodeURIComponent(bare);
  } catch {
    // A malformed escape: look the path up as written.
  }
  const relative = decoded.replace(LEADING_SLASHES, "");
  return relative === "" || relative.endsWith("/")
    ? `${relative}index.html`
    : relative;
};

/** A just-bash workspace has no ports: whatever the record says, nothing serves. */
const servers = (sources: PreviewSources): readonly SandboxPreview[] =>
  sources.provider === "just-bash" ? [] : sources.previews;

const staticServer = (sources: PreviewSources) =>
  servers(sources).find((preview) => preview.port === STATIC_PREVIEW_PORT);

/** The agent's own server: the newest preview that isn't the static one. */
const agentServer = (sources: PreviewSources) =>
  servers(sources)
    .filter((preview) => preview.port !== STATIC_PREVIEW_PORT)
    .at(-1);

/** The page to open on: the workspace's index, or its first HTML file. */
const indexPage = (sources: PreviewSources): string | null => {
  const { htmlPaths } = sources;
  if (htmlPaths.length === 0) {
    return null;
  }
  return htmlPaths.includes("index.html")
    ? "/"
    : pagePathOf(htmlPaths[0] ?? "");
};

/**
 * Where a page comes from. An HTML page prefers the static-files preview,
 * then the newest server, then a static render of the file. Anything else
 * (`/`, `/api/x`) is the agent's server's, or the static server's.
 */
export const targetOf = (
  sources: PreviewSources,
  page: BrowserPage
): PageTarget | null => {
  const pinned =
    page.port === null
      ? undefined
      : servers(sources).find((preview) => preview.port === page.port);
  if (pinned) {
    return { kind: "server", preview: pinned };
  }
  const html =
    isHtmlPath(page.path) ||
    (page.path.replace(QUERY_OR_HASH, "").endsWith("/") &&
      sources.htmlPaths.includes(workspaceFileOf(page.path)));
  const server = html
    ? (staticServer(sources) ?? servers(sources).at(-1))
    : (agentServer(sources) ?? staticServer(sources));
  if (server) {
    return { kind: "server", preview: server };
  }
  return html ? { kind: "static-render" } : null;
};

/**
 * The page Preview opens on: the agent's server if it started one, else
 * the workspace's HTML (served or rendered). `null` when there's nothing
 * to show, and the panel lists no Preview.
 */
export const defaultPage = (sources: PreviewSources): BrowserPage | null => {
  const agent = agentServer(sources);
  if (agent) {
    return { path: "/", port: agent.port };
  }
  const index = indexPage(sources);
  if (index) {
    return { path: index, port: null };
  }
  const served = staticServer(sources);
  return served ? { path: "/", port: served.port } : null;
};

/** The page for a preview URL the agent reported: its server, at its path. */
export const pageOfUrl = (
  sources: PreviewSources,
  url: string
): BrowserPage | null => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const preview = servers(sources).find((each) => {
    try {
      return new URL(each.url).origin === parsed.origin;
    } catch {
      return false;
    }
  });
  return preview
    ? {
        path: `${parsed.pathname}${parsed.search}${parsed.hash}`,
        port: preview.port,
      }
    : null;
};

/** The frame's URL for a served page. */
export const pageUrl = (preview: SandboxPreview, path: string): string =>
  new URL(path, preview.url).href;

// Addresses are resolved against a placeholder origin when there's no
// server: a static render has no origin of its own.
const RENDER_ORIGIN = "http://workspace.invalid";
const SCHEME = /^[a-z][a-z\d+.-]*:/i;

/**
 * What the person typed in the address bar, as a path on the page's origin,
 * or `null` if it points somewhere else. A bare `about.html` means
 * `/about.html`, as in a browser's address bar.
 */
export const readAddress = (
  typed: string,
  target: PageTarget | null
): string | null => {
  const text = typed.trim();
  if (text === "") {
    return null;
  }
  const origin =
    target?.kind === "server" ? new URL(target.preview.url).origin : null;
  const absolute = SCHEME.test(text) || text.startsWith("//");
  if (absolute && origin === null) {
    return null;
  }
  const base = origin ?? RENDER_ORIGIN;
  let url: URL;
  try {
    url = new URL(
      absolute ? text : `/${text.replace(LEADING_SLASHES, "")}`,
      base
    );
  } catch {
    return null;
  }
  return url.origin === new URL(base).origin
    ? `${url.pathname}${url.search}${url.hash}`
    : null;
};

/**
 * Where a link clicked in a static render goes: a page path, resolved
 * against the page it's on, or `null` for anything off the workspace.
 */
export const resolveLink = (from: string, href: string): string | null => {
  let url: URL;
  try {
    url = new URL(href, new URL(from, RENDER_ORIGIN));
  } catch {
    return null;
  }
  return url.origin === RENDER_ORIGIN
    ? `${url.pathname}${url.search}${url.hash}`
    : null;
};

/**
 * The browser's own history. `loads` counts every navigation and reload:
 * the frame is keyed by it, so going to the same page again loads it again.
 */
export interface BrowserHistory {
  readonly entries: readonly BrowserPage[];
  readonly index: number;
  readonly loads: number;
}

export type BrowserAction =
  | { readonly page: BrowserPage; readonly type: "navigate" }
  | { readonly type: "back" }
  | { readonly type: "forward" }
  | { readonly type: "reload" };

const samePage = (a: BrowserPage | undefined, b: BrowserPage) =>
  a?.path === b.path && a.port === b.port;

export const browserHistory = (
  history: BrowserHistory | null,
  action: BrowserAction
): BrowserHistory | null => {
  switch (action.type) {
    case "navigate": {
      if (!history) {
        return { entries: [action.page], index: 0, loads: 0 };
      }
      const { entries, index, loads } = history;
      if (samePage(entries[index], action.page)) {
        return { ...history, loads: loads + 1 };
      }
      // Like a browser: going somewhere new drops the forward entries.
      return {
        entries: [...entries.slice(0, index + 1), action.page],
        index: index + 1,
        loads: loads + 1,
      };
    }
    case "back":
      return history && history.index > 0
        ? { ...history, index: history.index - 1, loads: history.loads + 1 }
        : history;
    case "forward":
      return history && history.index < history.entries.length - 1
        ? { ...history, index: history.index + 1, loads: history.loads + 1 }
        : history;
    case "reload":
      return history && { ...history, loads: history.loads + 1 };
    default:
      return action satisfies never;
  }
};

export const currentPage = (
  history: BrowserHistory | null
): BrowserPage | null => history?.entries[history.index] ?? null;

export const canGoBack = (history: BrowserHistory | null): boolean =>
  (history?.index ?? 0) > 0;

export const canGoForward = (history: BrowserHistory | null): boolean =>
  history !== null && history.index < history.entries.length - 1;

/** Asks the panel's Preview to show a page; a new `id` asks again. */
export interface PreviewRequest {
  readonly id: number;
  readonly page: BrowserPage | null;
}

/** How a file that renders is shown: rendered, or as code in the editor. */
export type FileMode = "rendered" | "code";

/** Files the panel renders (with a Code toggle) rather than opening as code. */
export const renderedKind = (path: string): "html" | "markdown" | null => {
  if (isHtmlPath(path)) {
    return "html";
  }
  return isMarkdownPath(path) ? "markdown" : null;
};

/**
 * The mode a file opens in: the person's choice, else rendered, unless it
 * opened empty (a new file), which has nothing to render yet and is
 * waiting to be written.
 */
export const openingMode = (
  chosen: FileMode | undefined,
  openedEmpty: boolean
): FileMode => chosen ?? (openedEmpty ? "code" : "rendered");
