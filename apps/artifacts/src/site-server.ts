import type { KindTheme } from "@workspace/artifacts-kit/kind-theme";
import {
  type BuiltSite,
  buildSite,
  type CompileTailwind,
} from "@workspace/artifacts-kit/kinds/site/build";
import {
  extensionOf,
  type SiteContent,
  siteContentSchema,
} from "@workspace/artifacts-kit/kinds/site/content";
import { siteContentSecurityPolicy } from "@workspace/artifacts-kit/kinds/site/csp";
import { publishedArtifactSchema } from "@workspace/contract/schemas/files";
import { publicConfigSchema } from "@workspace/contract/schemas/meta";

import { SITE_RUNTIME_META, siteTsxPorts } from "./site-tsx";

// The server's part in Sites (125). It serves the preview page with the
// site CSP, and published sites at /s/<token>/<path>: it asks the app's API
// for what the link serves (`GET /api/published/{token}`), builds it with
// Tailwind (TSX pages compiled to shells that mount in the visitor's
// browser, 163), and answers each file with the published CSP. The public
// origins come from the app's public config (`GET /api/config`), which is
// where admins set them (`artifacts.kinds.site.allowedOrigins`); if the app
// can't be reached, sites get none: the CSP fails closed.

export interface SiteServerOptions {
  /** The app's origin (`ARTIFACTS_API_ORIGIN`), or `null` when it isn't set. */
  readonly apiOrigin: string | null;
  /** Who may frame a preview, and a published page. */
  readonly appOrigins: readonly string[];
  readonly compile: CompileTailwind;
  readonly fetch: typeof globalThis.fetch;
  readonly now?: () => number;
  /**
   * Where the site runtime (`./site-runtime.ts`) is served, for TSX pages'
   * shells (163), or `null` if the build has none, when TSX pages fail.
   */
  readonly runtimeUrl: () => string | null;
  /** The instance's own site theme, read when a site is built. */
  readonly theme?: () => Promise<KindTheme>;
  readonly themeCss: string;
}

export interface SiteResponse {
  readonly body: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly status: number;
}

/** How long the origins are trusted before asking the app again. */
const ORIGINS_TTL_MS = 30_000;
const BUILDS_KEPT = 50;

const LEADING_SLASHES = /^\/+/;
const TOKEN = /^\/s\/([A-Za-z0-9_-]{22,128})(\/.*)?$/;

const SITE_TYPES: Readonly<Record<string, string>> = {
  css: "text/css; charset=utf-8",
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  svg: "image/svg+xml",
  txt: "text/plain; charset=utf-8",
};

const COMMON_HEADERS = {
  // Module scripts from an opaque origin are cross-origin fetches.
  "Access-Control-Allow-Origin": "*",
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), clipboard-read=()",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
} as const;

const text = (status: number, body: string): SiteResponse => ({
  body,
  headers: {
    ...COMMON_HEADERS,
    "Content-Security-Policy": "default-src 'none'",
    "Content-Type": "text/plain; charset=utf-8",
  },
  status,
});

const SITE_RUNTIME_FILE = /^site-runtime-[A-Za-z0-9]+\.js$/;

/** Whether `name` is the site runtime's bundle, as `build:runtime` names it. */
export const isSiteRuntimeFile = (name: string): boolean =>
  SITE_RUNTIME_FILE.test(name);

/**
 * The preview page with where the site runtime is (`url`, a path on this
 * origin) written into its head, for `site-main.ts` to read.
 */
export const withSiteRuntime = (page: string, url: string | null): string =>
  url === null
    ? page
    : page.replace(
        "<head>",
        `<head><meta name="${SITE_RUNTIME_META}" content="${url.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}">`
      );

/** The file a published site's request names, inside the site. */
export const sitePathOf = (rest: string): string | null => {
  let decoded: string;
  try {
    decoded = decodeURIComponent(rest);
  } catch {
    return null;
  }
  const path = decoded.replace(LEADING_SLASHES, "");
  if (path.split("/").some((part) => part === ".." || part.startsWith("."))) {
    return null;
  }
  return path === "" || path.endsWith("/") ? `${path}index.html` : path;
};

export const createSiteServer = (options: SiteServerOptions) => {
  const now = options.now ?? Date.now;
  let origins: {
    readonly at: number;
    readonly value: readonly string[];
  } | null = null;
  const builds = new Map<string, BuiltSite>();

  const api = (path: string) =>
    options.apiOrigin
      ? options.fetch(`${options.apiOrigin}/api${path}`, {
          headers: { accept: "application/json" },
        })
      : Promise.reject(new Error("ARTIFACTS_API_ORIGIN isn't set"));

  /** The public origins sites may load from, as the app says now. */
  const allowedOrigins = async (): Promise<readonly string[]> => {
    if (origins && now() - origins.at < ORIGINS_TTL_MS) {
      return origins.value;
    }
    try {
      const response = await api("/config");
      const parsed = publicConfigSchema.safeParse(
        response.ok ? await response.json() : null
      );
      const value = parsed.success ? parsed.data.artifacts.siteOrigins : [];
      origins = { at: now(), value };
      return value;
    } catch {
      // Unreachable: no origins, and ask again next time.
      return [];
    }
  };

  /** The preview page's CSP, for `site.html`. */
  const previewPolicy = async (): Promise<string> =>
    siteContentSecurityPolicy({
      allowedOrigins: await allowedOrigins(),
      frameAncestors: options.appOrigins,
      mode: "preview",
    });

  /** What a link serves, from the app: the site and when it was published. */
  const fetchPublished = async (
    token: string
  ): Promise<
    | { readonly content: SiteContent; readonly publishedAt: string }
    | SiteResponse
  > => {
    let response: Response;
    try {
      response = await api(`/published/${token}`);
    } catch {
      return text(502, "This site can't be reached right now.");
    }
    if (response.status === 404 || response.status === 403) {
      return text(404, "There's no site at this link.");
    }
    const published = publishedArtifactSchema.safeParse(
      response.ok ? await response.json() : null
    );
    if (!published.success) {
      return text(502, "This site can't be reached right now.");
    }
    const content = siteContentSchema.safeParse(published.data.content);
    return published.data.kind === "site" && content.success
      ? { content: content.data, publishedAt: published.data.publishedAt }
      : text(404, "There's no site at this link.");
  };

  /** Keeps a build, dropping the oldest past `BUILDS_KEPT`. */
  const keep = (key: string, built: BuiltSite) => {
    const [oldest] = builds.keys();
    if (builds.size >= BUILDS_KEPT && oldest !== undefined) {
      builds.delete(oldest);
    }
    builds.set(key, built);
  };

  const publishedBuild = async (
    token: string
  ): Promise<BuiltSite | SiteResponse> => {
    const published = await fetchPublished(token);
    if ("status" in published) {
      return published;
    }
    try {
      const theme = await options.theme?.();
      const key = JSON.stringify([
        token,
        published.publishedAt,
        Object.entries(theme?.light ?? {}).sort(([a], [b]) =>
          a.localeCompare(b)
        ),
        Object.entries(theme?.dark ?? {}).sort(([a], [b]) =>
          a.localeCompare(b)
        ),
      ]);
      const kept = builds.get(key);
      if (kept) {
        return kept;
      }
      const runtimeUrl = options.runtimeUrl();
      const built = await buildSite(
        published.content,
        {
          compile: options.compile,
          theme,
          themeCss: options.themeCss,
          tsx: runtimeUrl ? siteTsxPorts(runtimeUrl) : undefined,
        },
        "published"
      );
      keep(key, built);
      return built;
    } catch {
      return text(500, "This site couldn't be built.");
    }
  };

  /**
   * A request under /s/: a published site's file, a redirect to the site's
   * root, or `null` for a path that isn't a published site's at all.
   */
  const published = async (pathname: string): Promise<SiteResponse | null> => {
    const match = TOKEN.exec(pathname);
    if (!match) {
      return null;
    }
    const [, token = "", rest] = match;
    if (rest === undefined) {
      // Relative links resolve from the folder, so a site lives at /s/<token>/.
      return {
        body: "",
        headers: { ...COMMON_HEADERS, Location: `/s/${token}/` },
        status: 308,
      };
    }
    const path = sitePathOf(rest);
    if (path === null) {
      return text(404, "Not found");
    }
    const built = await publishedBuild(token);
    if ("status" in built) {
      return built;
    }
    const file = built.files[path];
    if (file === undefined) {
      return text(404, "Not found");
    }
    return {
      body: file,
      headers: {
        ...COMMON_HEADERS,
        "Cache-Control": "no-cache",
        "Content-Security-Policy": siteContentSecurityPolicy({
          allowedOrigins: await allowedOrigins(),
          frameAncestors: options.appOrigins,
          mode: "published",
        }),
        "Content-Type":
          SITE_TYPES[extensionOf(path)] ?? "application/octet-stream",
      },
      status: 200,
    };
  };

  return { allowedOrigins, previewPolicy, published };
};
