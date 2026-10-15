import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

import { buildPreview, navigationTarget, pageError } from "./site-preview";
import {
  createSiteServer,
  isSiteRuntimeFile,
  sitePathOf,
  withSiteRuntime,
} from "./site-server";
import { siteTsxPorts } from "./site-tsx";
import { tailwindCompiler } from "./tailwind";

// Sites in the runtime (125): Tailwind compiled over the instance theme,
// the preview's build, and the server's published links and CSP, against a
// stand-in for the app's API.

const require = createRequire(import.meta.url);
const tailwindCss = await readFile(
  require.resolve("tailwindcss/index.css"),
  "utf8"
);
const themeCss = await readFile(
  new URL("../../../packages/ui/src/styles/globals.css", import.meta.url),
  "utf8"
);
const compile = tailwindCompiler(tailwindCss);

const TOKEN = "t".repeat(43);
const SITE = JSON.stringify({
  files: {
    "about.html":
      "<!doctype html><html><head></head><body><a href='index.html'>Home</a></body></html>",
    "index.html":
      '<!doctype html><html><head><title>Harbour</title></head><body class="bg-background p-6"><h1 class="text-primary">Hi</h1><a href="about.html">About</a></body></html>',
    "notes.txt": "plain",
  },
});

const config = (siteOrigins: readonly string[]) => ({
  artifacts: { siteOrigins },
  auth: { providers: [], signup: "open" },
  brand: { faviconUrl: null, logoUrl: null, name: "Chat" },
  features: {
    fileUploads: true,
    importers: true,
    memory: true,
    publicLinks: true,
    sandboxes: true,
    webSearch: true,
  },
  limits: { memoryMaxChars: 8000, uploadMaxMb: 25 },
  policies: { chatContexts: ["personal"] },
  sandbox: { default: null, providers: [] },
});

/** A TSX site (163): a home page from site-ui's blocks, and an HTML page. */
const TSX_SITE = JSON.stringify({
  files: {
    "about.html":
      "<!doctype html><html><head></head><body><a href='index.html'>Home</a></body></html>",
    "index.tsx": [
      'import { FeatureGrid, Hero, Page } from "@workspace/site-ui";',
      "export default function Home() {",
      '  return <Page><Hero title="Harbour walks" /><FeatureGrid features={[{ title: "Small groups", description: "Eight at most." }]} /></Page>;',
      "}",
    ].join("\n"),
  },
});
const RUNTIME = "/site-runtime-abc123.js";

/** The app's API: its config, and one published site. */
const fakeApi = (
  overrides: {
    readonly published?: Response;
    readonly down?: boolean;
    readonly site?: string;
  } = {}
) => {
  const calls: string[] = [];
  const fetch = (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (overrides.down) {
      return Promise.reject(new Error("ECONNREFUSED"));
    }
    if (url.endsWith("/api/config")) {
      return Promise.resolve(
        Response.json(config(["https://fonts.googleapis.com"]))
      );
    }
    if (url.endsWith(`/api/published/${TOKEN}`)) {
      return Promise.resolve(
        overrides.published ??
          Response.json({
            content: overrides.site ?? SITE,
            kind: "site",
            publishedAt: "2026-10-02T00:00:00.000Z",
            title: "Harbour",
          })
      );
    }
    return Promise.resolve(new Response(null, { status: 404 }));
  };
  return { calls, fetch: fetch as typeof globalThis.fetch };
};

const server = (api = fakeApi(), runtimeUrl: string | null = RUNTIME) =>
  createSiteServer({
    apiOrigin: "http://app.test",
    appOrigins: ["https://chat.example"],
    compile,
    fetch: api.fetch,
    runtimeUrl: () => runtimeUrl,
    themeCss,
  });

describe("Tailwind for sites", () => {
  it("compiles the classes a site uses over the instance's tokens", async () => {
    const css = await compile(
      '@import "tailwindcss";\n@theme inline { --color-primary: var(--primary); }',
      ["text-primary", "p-6", "not-a-class"]
    );
    expect(css).toContain(".text-primary {\n    color: var(--primary);");
    expect(css).toContain(".p-6 {");
    expect(css).not.toContain("not-a-class");
    await expect(compile('@import "other.css";', [])).rejects.toThrow(
      `a site's styles can't import "other.css"`
    );
  });
});

describe("the site preview", () => {
  it("builds a site's pages with their CSS, or says why it can't", async () => {
    const built = await buildPreview(SITE, { compile, themeCss });
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.value.css).toContain(".bg-background");
      expect(built.value.files["index.html"]).toContain(
        "<style data-site-theme>"
      );
      expect(
        navigationTarget(
          { channel: "site-preview/1", page: "about.html", type: "navigate" },
          built.value
        )
      ).toBe("about.html");
      expect(
        navigationTarget(
          { channel: "site-preview/1", page: "secret.html", type: "navigate" },
          built.value
        )
      ).toBeNull();
      expect(navigationTarget({ page: "about.html" }, built.value)).toBeNull();
    }
    expect(await buildPreview("<html>", { compile, themeCss })).toEqual({
      error: {
        kind: "syntax",
        message: 'content isn\'t JSON. A site is {"files": {"index.tsx": "…"}}',
      },
      ok: false,
    });
  });

  it("builds a TSX page as a shell that mounts it with the site runtime (163)", async () => {
    const built = await buildPreview(TSX_SITE, {
      compile,
      themeCss,
      tsx: siteTsxPorts(`https://runtime.example${RUNTIME}`),
    });
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(Object.keys(built.value.files).sort()).toEqual([
        "about.html",
        "index.html",
      ]);
      const index = built.value.files["index.html"];
      expect(index).toContain(
        `import { mountPage } from "https://runtime.example${RUNTIME}";`
      );
      expect(index).toContain("require('@workspace/site-ui')");
      expect(index).not.toContain("<Hero");
      // site-ui's classes are built, though the site's files don't name them.
      expect(built.value.css).toContain(".text-muted-foreground");
      expect(built.value.css).toContain(".rounded-xl");
    }
    const broken = await buildPreview(
      JSON.stringify({ files: { "index.tsx": "export default () => <p" } }),
      { compile, themeCss, tsx: siteTsxPorts(RUNTIME) }
    );
    expect(broken.ok ? null : broken.error.kind).toBe("render");
    const unbuilt = await buildPreview(TSX_SITE, { compile, themeCss });
    expect(unbuilt.ok ? null : unbuilt.error.message).toContain(
      "index.tsx is a TSX page, and this runtime can't build them"
    );
  });

  it("hears a TSX page's render error, and nothing else", () => {
    expect(
      pageError({
        channel: "site-preview/1",
        message: "Hero is not defined",
        page: "index.html",
        type: "error",
      })
    ).toEqual({ kind: "render", message: "index.html: Hero is not defined" });
    expect(
      pageError({ message: "x", page: "index.html", type: "error" })
    ).toBeNull();
    expect(
      pageError({ channel: "site-preview/1", page: "a.html", type: "navigate" })
    ).toBeNull();
  });

  it("is told where the site runtime is", () => {
    expect(withSiteRuntime("<html><head><title>x</title>", RUNTIME)).toBe(
      `<html><head><meta name="site-runtime" content="${RUNTIME}"><title>x</title>`
    );
    expect(withSiteRuntime("<head>", null)).toBe("<head>");
    expect(isSiteRuntimeFile("site-runtime-abc123.js")).toBe(true);
    expect(isSiteRuntimeFile("site-runtime-abc123.js.map")).toBe(false);
    expect(isSiteRuntimeFile("site-abc123.js")).toBe(false);
  });
});

describe("published sites", () => {
  it("serve each file with the published CSP and the app's origins", async () => {
    const sites = server();
    const page = await sites.published(`/s/${TOKEN}/`);
    expect(page?.status).toBe(200);
    expect(page?.headers["Content-Type"]).toBe("text/html; charset=utf-8");
    expect(page?.body).toContain("<head><style data-site-theme>");
    expect(page?.body).toContain(".text-primary");
    const policy = page?.headers["Content-Security-Policy"] ?? "";
    expect(policy).toContain(
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;"
    );
    expect(policy).toContain("connect-src 'none'");
    expect(policy).toContain("frame-ancestors https://chat.example;");
    expect(policy).toContain(
      "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox"
    );
    expect((await sites.published(`/s/${TOKEN}/about.html`))?.status).toBe(200);
    expect(
      (await sites.published(`/s/${TOKEN}/notes.txt`))?.headers["Content-Type"]
    ).toBe("text/plain; charset=utf-8");
  });

  it("serve a TSX page as its shell, importing the runtime from this origin, and never the TSX", async () => {
    const sites = server(fakeApi({ site: TSX_SITE }));
    const page = await sites.published(`/s/${TOKEN}/`);
    expect(page?.status).toBe(200);
    expect(page?.body).toContain(`import { mountPage } from "${RUNTIME}";`);
    expect(page?.body).toContain('<div id="root"></div>');
    expect(page?.headers["Content-Security-Policy"]).toContain(
      "script-src 'self' 'unsafe-inline' https://fonts.googleapis.com;"
    );
    expect((await sites.published(`/s/${TOKEN}/index.tsx`))?.status).toBe(404);
    expect((await sites.published(`/s/${TOKEN}/about.html`))?.status).toBe(200);
    const noRuntime = server(fakeApi({ site: TSX_SITE }), null);
    expect((await noRuntime.published(`/s/${TOKEN}/`))?.status).toBe(500);
  });

  it("redirect to the site's folder, and 404 what isn't there", async () => {
    const sites = server();
    expect(await sites.published(`/s/${TOKEN}`)).toMatchObject({
      headers: { Location: `/s/${TOKEN}/` },
      status: 308,
    });
    expect((await sites.published(`/s/${TOKEN}/missing.html`))?.status).toBe(
      404
    );
    expect((await sites.published(`/s/${"u".repeat(43)}/`))?.status).toBe(404);
    expect(await sites.published("/s/short/")).toBeNull();
    expect(await sites.published("/site.html")).toBeNull();
    expect(sitePathOf("/../secret")).toBeNull();
    expect(sitePathOf("/.env")).toBeNull();
    expect(sitePathOf("/docs/")).toBe("docs/index.html");
    expect(sitePathOf("/%E0%A4%A")).toBeNull();
  });

  it("build once per published version, and ask for the origins at most every 30 s", async () => {
    const api = fakeApi();
    const sites = server(api);
    await sites.published(`/s/${TOKEN}/`);
    await sites.published(`/s/${TOKEN}/about.html`);
    expect(api.calls.filter((url) => url.endsWith("/api/config"))).toHaveLength(
      1
    );
    // The link is read each time, so unpublishing takes effect at once.
    expect(api.calls.filter((url) => url.includes("/published/"))).toHaveLength(
      2
    );
  });

  it("fail closed when the app can't be reached", async () => {
    const sites = server(fakeApi({ down: true }));
    expect((await sites.published(`/s/${TOKEN}/`))?.status).toBe(502);
    expect(await sites.previewPolicy()).toContain(
      "script-src 'self' 'unsafe-inline';"
    );
    const unpublished = server(
      fakeApi({ published: new Response(null, { status: 403 }) })
    );
    expect((await unpublished.published(`/s/${TOKEN}/`))?.status).toBe(404);
  });

  it("give the preview page the site CSP, framed by the app only", async () => {
    const policy = await server().previewPolicy();
    expect(policy).toContain(
      "img-src 'self' data: blob: https://fonts.googleapis.com;"
    );
    expect(policy).toContain("frame-src 'self'");
    expect(policy).toContain("frame-ancestors https://chat.example;");
    expect(policy.endsWith("sandbox allow-scripts")).toBe(true);
  });
});
