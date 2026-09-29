import { err, ok } from "@workspace/shared/result";
import { describe, expect, it, vi } from "vitest";

import { renderStaticPage, type StaticFile, workspaceRef } from "./static-page";

// The just-bash fallback's inliner (066): local stylesheets, scripts and
// images go into the page, up to a cap; everything else is left alone.

const files = (entries: Record<string, StaticFile>) =>
  vi.fn((path: string) =>
    Promise.resolve(
      entries[path] ? ok(entries[path]) : err(`${path}: no such file`)
    )
  );

const SVG_DATA_URL = /^data:image\/svg\+xml;base64,/;

const text = (content: string): StaticFile => ({ content, encoding: "utf8" });

const parse = (html: string) =>
  new DOMParser().parseFromString(html, "text/html");

describe("renderStaticPage", () => {
  it("inlines the page's stylesheets, scripts and images", async () => {
    const read = files({
      "site/app.js": text("document.title = '</script>ok';"),
      "site/css/style.css": text("body { color: red; }"),
      "site/logo.png": { content: "iVBORw0KGgo=", encoding: "base64" },
      "site/mark.svg": text("<svg xmlns='http://www.w3.org/2000/svg'/>"),
    });
    const { html, skipped } = await renderStaticPage({
      html: `<!doctype html><html><head>
        <link rel="stylesheet" href="css/style.css" media="screen">
        <script src="./app.js"></script>
      </head><body><img src="logo.png" alt="Logo"><img src="mark.svg"></body></html>`,
      path: "site/index.html",
      read,
    });
    expect(skipped).toEqual([]);
    const doc = parse(html);
    const style = doc.querySelector("style");
    expect(style?.textContent).toBe("body { color: red; }");
    expect(style?.getAttribute("media")).toBe("screen");
    expect(doc.querySelector("link")).toBeNull();
    const scripts = [...doc.querySelectorAll("script")];
    // The panel's link script first, then the page's own, inlined without
    // closing itself early.
    expect(scripts).toHaveLength(2);
    expect(scripts[1]?.hasAttribute("src")).toBe(false);
    expect(scripts[1]?.textContent).toBe("document.title = '<\\/script>ok';");
    const [png, svg] = [...doc.querySelectorAll("img")];
    expect(png?.getAttribute("src")).toBe("data:image/png;base64,iVBORw0KGgo=");
    expect(png?.getAttribute("alt")).toBe("Logo");
    expect(svg?.getAttribute("src")).toMatch(SVG_DATA_URL);
    expect(html.startsWith("<!doctype html>")).toBe(true);
  });

  it("leaves remote and data URLs alone, and lists missing files", async () => {
    const read = files({});
    const { html, skipped } = await renderStaticPage({
      html: `<link rel="stylesheet" href="https://cdn.example.com/a.css">
        <script src="//cdn.example.com/b.js"></script>
        <img src="data:image/png;base64,AAAA"><img src="missing.png">`,
      path: "index.html",
      read,
    });
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith("missing.png");
    expect(skipped).toEqual(["missing.png"]);
    const doc = parse(html);
    expect(doc.querySelector("link")?.getAttribute("href")).toBe(
      "https://cdn.example.com/a.css"
    );
    expect(doc.querySelector("img")?.getAttribute("src")).toBe(
      "data:image/png;base64,AAAA"
    );
  });

  it("stops inlining at the cap, keeping what comes first", async () => {
    const read = files({
      "a.css": text("a".repeat(40)),
      "b.css": text("b".repeat(40)),
    });
    const page = `<link rel="stylesheet" href="a.css"><link rel="stylesheet" href="b.css">`;
    const { html, skipped } = await renderStaticPage({
      html: page,
      maxBytes: page.length + 50,
      path: "index.html",
      read,
    });
    expect(skipped).toEqual(["b.css"]);
    const doc = parse(html);
    expect(doc.querySelector("style")?.textContent).toBe("a".repeat(40));
    expect(doc.querySelector("link")?.getAttribute("href")).toBe("b.css");
  });

  it("hands links to other pages to the panel", async () => {
    const { html } = await renderStaticPage({
      html: `<a href="about.html">About</a>`,
      path: "index.html",
      read: files({}),
    });
    expect(parse(html).querySelector("script")?.textContent).toContain(
      "workspace-preview-link"
    );
  });
});

describe("workspaceRef", () => {
  it("resolves against the page, and refuses what isn't a workspace file", () => {
    expect(workspaceRef("site/index.html", "css/a.css")).toBe("site/css/a.css");
    expect(workspaceRef("site/index.html", "../a.js")).toBe("a.js");
    expect(workspaceRef("site/index.html", "/root.png?v=2")).toBe("root.png");
    expect(workspaceRef("index.html", "my%20pic.png")).toBe("my pic.png");
    expect(workspaceRef("index.html", "#top")).toBeNull();
    expect(workspaceRef("index.html", "https://a.test/x.js")).toBeNull();
    expect(workspaceRef("index.html", "data:text/css,a")).toBeNull();
  });
});
