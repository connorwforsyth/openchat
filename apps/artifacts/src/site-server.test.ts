import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

import { buildPreview, navigationTarget } from "./site-preview";
import { createSiteServer, sitePathOf } from "./site-server";
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

/** The app's API: its config, and one published site. */
const fakeApi = (
  overrides: { readonly published?: Response; readonly down?: boolean } = {}
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
            content: SITE,
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

const server = (api = fakeApi()) =>
  createSiteServer({
    apiOrigin: "http://app.test",
    appOrigins: ["https://chat.example"],
    compile,
    fetch: api.fetch,
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
        message:
          'content isn\'t JSON. A site is {"stack": "html-tailwind", "files": {"index.html": "…"}}',
      },
      ok: false,
    });
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
