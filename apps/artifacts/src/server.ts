import { spawn } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { appOriginsFrom, responseHeaders } from "./headers";
import { readKindThemes, themeOf, withKindThemes } from "./kind-themes";
import { SITE_ASSETS } from "./site-assets";
import {
  createSiteServer,
  isSiteRuntimeFile,
  withSiteRuntime,
} from "./site-server";
import { tailwindCompiler } from "./tailwind";

// Serves the built runtime (dist/public) with its security headers. A static
// file server rather than a framework: the page is the whole app. Runs under
// bun in development (`--watch` also rebuilds on change) and under node from
// the bundle in dist/server.js, which is why the path below works from both.

const envSchema = z.object({
  /**
   * The app (125): where published sites and the sites' public origins
   * come from. Unset, published links 502 and sites load nothing from
   * outside.
   */
  ARTIFACTS_API_ORIGIN: z
    .url()
    .transform((url) => new URL(url).origin)
    .optional()
    .catch(undefined),
  ARTIFACTS_APP_ORIGINS: z.string().optional(),
  /**
   * The instance's brand folder: its `theme.css` and
   * `kinds/<kind>/theme.css` restyle decks and sites. Unset, they use the
   * app theme.
   */
  ARTIFACTS_BRAND_DIR: z.string().min(1).optional().catch(undefined),
  // Loopback unless told otherwise; the image listens on 0.0.0.0.
  ARTIFACTS_HOST: z.string().min(1).catch("127.0.0.1"),
  ARTIFACTS_PORT: z.coerce.number().int().min(1).max(65_535).catch(3910),
});

const env = envSchema.parse(process.env);
const appOrigins = appOriginsFrom(env.ARTIFACTS_APP_ORIGINS);
const publicDir = fileURLToPath(new URL("../dist/public/", import.meta.url));
const watching = process.argv.includes("--watch");

const readText = (path: string) => readFile(path, "utf8").catch(() => null);
// Read per request: a brand file edited shows on the next load.
const kindThemes = () =>
  readKindThemes(env.ARTIFACTS_BRAND_DIR ?? null, readText);

/** The runtime's pages, which carry the themes. */
const PAGES = new Set(["/", "/index.html", "/site.html"]);

/**
 * The site runtime's bundle (163), `/site-runtime-<hash>.js`, or `null`
 * if the build has none. The newest, since a watching build leaves old ones.
 */
const locateSiteRuntime = async (): Promise<string | null> => {
  const names = await readdir(publicDir).catch(() => [] as string[]);
  const found = await Promise.all(
    names.filter(isSiteRuntimeFile).map(async (name) => ({
      at: (await stat(resolve(publicDir, name))).mtimeMs,
      name,
    }))
  );
  const [newest] = found.sort((a, b) => b.at - a.at);
  return newest ? `/${newest.name}` : null;
};

// Found at boot; while watching, the bundle's name changes with each
// rebuild, so it's looked up again whenever it's needed.
let siteRuntime = await locateSiteRuntime();
const siteRuntimeUrl = async () => {
  if (watching) {
    siteRuntime = await locateSiteRuntime();
  }
  return siteRuntime;
};
if (!(siteRuntime || watching)) {
  console.warn(
    "No site-runtime-*.js in dist/public: TSX site pages won't build. Run `bun run build:public`."
  );
}

const sites = createSiteServer({
  apiOrigin: env.ARTIFACTS_API_ORIGIN ?? null,
  appOrigins,
  compile: tailwindCompiler(SITE_ASSETS.tailwindCss),
  fetch: globalThis.fetch,
  runtimeUrl: () => siteRuntime,
  theme: async () => themeOf(await kindThemes(), "site"),
  themeCss: SITE_ASSETS.themeCss,
});

/** The site preview page (125), which gets the site CSP instead of the runtime's. */
const SITE_PAGE = "/site.html";

/** The file a request path names, or `null` if it escapes `publicDir`. */
const fileFor = (pathname: string): string | null => {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const file = resolve(
    publicDir,
    `.${decoded.endsWith("/") ? `${decoded}index.html` : decoded}`
  );
  return file.startsWith(publicDir.endsWith(sep) ? publicDir : publicDir + sep)
    ? file
    : null;
};

const server = createServer(async (request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }
  const { pathname } = new URL(request.url ?? "/", "http://runtime");
  if (pathname.startsWith("/s/")) {
    await siteRuntimeUrl();
    const site = await sites.published(pathname).catch(() => null);
    if (site) {
      response.writeHead(site.status, site.headers);
      response.end(request.method === "HEAD" ? undefined : site.body);
      return;
    }
  }
  const file = fileFor(pathname);
  const body = file ? await readFile(file).catch(() => null) : null;
  if (!(file && body)) {
    response.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
    return;
  }
  const headers = responseHeaders(file, appOrigins);
  if (pathname === SITE_PAGE) {
    response.writeHead(200, {
      ...headers,
      "Content-Security-Policy": await sites.previewPolicy(),
    });
    response.end(
      request.method === "HEAD"
        ? undefined
        : withKindThemes(
            withSiteRuntime(body.toString("utf8"), await siteRuntimeUrl()),
            await kindThemes()
          )
    );
    return;
  }
  response.writeHead(200, headers);
  if (request.method === "HEAD") {
    response.end();
  } else if (PAGES.has(pathname)) {
    response.end(withKindThemes(body.toString("utf8"), await kindThemes()));
  } else {
    response.end(body);
  }
});

if (watching) {
  // Development: rebuild the page whenever its source changes, and stop
  // the watcher with the server.
  const watchers = ["build:pages", "build:runtime"].map((script) =>
    spawn("bun", ["run", script, "--watch"], { stdio: "inherit" })
  );
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      for (const watcher of watchers) {
        watcher.kill(signal);
      }
      process.exit(0);
    });
  }
}

server.listen(env.ARTIFACTS_PORT, env.ARTIFACTS_HOST, () => {
  console.log(
    `artifact runtime on http://${env.ARTIFACTS_HOST}:${env.ARTIFACTS_PORT}, embeddable by ${appOrigins.join(" ")}`
  );
});
