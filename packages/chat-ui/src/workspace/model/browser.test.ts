import { STATIC_PREVIEW_PORT } from "@workspace/sandbox/tools/static-preview";
import { describe, expect, it } from "vitest";

import {
  type BrowserHistory,
  browserHistory,
  canGoBack,
  canGoForward,
  currentPage,
  defaultPage,
  openingMode,
  type PreviewSources,
  pageOfUrl,
  pageUrl,
  readAddress,
  renderedKind,
  resolveLink,
  targetOf,
  workspaceFileOf,
} from "./browser";

const agent = { port: 5173, url: "https://s-5173.preview.test/" };
const staticFiles = {
  port: STATIC_PREVIEW_PORT,
  url: "https://s-4747.preview.test/",
};

const sources = (overrides: Partial<PreviewSources> = {}): PreviewSources => ({
  htmlPaths: [],
  previews: [],
  provider: "docker",
  ...overrides,
});

describe("where a page comes from", () => {
  it("an HTML page: the static-files preview, else the newest server, else a static render", () => {
    const page = { path: "/index.html", port: null };
    expect(targetOf(sources({ previews: [agent, staticFiles] }), page)).toEqual(
      { kind: "server", preview: staticFiles }
    );
    expect(targetOf(sources({ previews: [agent] }), page)).toEqual({
      kind: "server",
      preview: agent,
    });
    expect(targetOf(sources(), page)).toEqual({ kind: "static-render" });
  });

  it("anything else: the agent's server, then the static one", () => {
    const page = { path: "/api/items", port: null };
    expect(targetOf(sources({ previews: [staticFiles, agent] }), page)).toEqual(
      { kind: "server", preview: agent }
    );
    expect(targetOf(sources({ previews: [staticFiles] }), page)).toEqual({
      kind: "server",
      preview: staticFiles,
    });
    expect(targetOf(sources(), page)).toBeNull();
  });

  it("a directory with an index.html is a page", () => {
    expect(
      targetOf(sources({ htmlPaths: ["docs/index.html"] }), {
        path: "/docs/",
        port: null,
      })
    ).toEqual({ kind: "static-render" });
  });

  it("keeps a pinned server while it's recorded", () => {
    const both = sources({ previews: [agent, staticFiles] });
    expect(targetOf(both, { path: "/a.html", port: 5173 })).toEqual({
      kind: "server",
      preview: agent,
    });
    // Gone: the rules pick again.
    expect(
      targetOf(sources({ previews: [staticFiles] }), {
        path: "/a.html",
        port: 5173,
      })
    ).toEqual({ kind: "server", preview: staticFiles });
  });

  it("serves nothing on just-bash, whatever the record says", () => {
    expect(
      targetOf(sources({ previews: [agent], provider: "just-bash" }), {
        path: "/index.html",
        port: null,
      })
    ).toEqual({ kind: "static-render" });
  });
});

describe("the page Preview opens on", () => {
  it("prefers the agent's server, then the workspace's index or first page", () => {
    expect(
      defaultPage(sources({ htmlPaths: ["index.html"], previews: [agent] }))
    ).toEqual({ path: "/", port: 5173 });
    expect(
      defaultPage(sources({ htmlPaths: ["b.html", "index.html"] }))
    ).toEqual({ path: "/", port: null });
    expect(defaultPage(sources({ htmlPaths: ["site/about.html"] }))).toEqual({
      path: "/site/about.html",
      port: null,
    });
    expect(defaultPage(sources())).toBeNull();
  });

  it("finds a preview URL's server and path", () => {
    expect(
      pageOfUrl(
        sources({ previews: [agent] }),
        "https://s-5173.preview.test/app?x=1"
      )
    ).toEqual({ path: "/app?x=1", port: 5173 });
    expect(
      pageOfUrl(sources({ previews: [agent] }), "https://elsewhere.test/")
    ).toBeNull();
  });

  it("builds a served page's URL on the preview origin", () => {
    expect(pageUrl(agent, "/about.html#top")).toBe(
      "https://s-5173.preview.test/about.html#top"
    );
  });
});

describe("paths and addresses", () => {
  it("names the workspace file a page path serves", () => {
    expect(workspaceFileOf("/")).toBe("index.html");
    expect(workspaceFileOf("/docs/")).toBe("docs/index.html");
    expect(workspaceFileOf("/a%20b.html?x#y")).toBe("a b.html");
  });

  it("reads a typed address as a path on the page's origin", () => {
    const served = { kind: "server" as const, preview: agent };
    expect(readAddress("about.html", served)).toBe("/about.html");
    expect(readAddress("  /a?b=1#c ", served)).toBe("/a?b=1#c");
    expect(readAddress("https://s-5173.preview.test/x", served)).toBe("/x");
    expect(readAddress("https://example.com/", served)).toBeNull();
    expect(readAddress("", served)).toBeNull();
    const rendered = { kind: "static-render" as const };
    expect(readAddress("docs/a.html", rendered)).toBe("/docs/a.html");
    expect(readAddress("https://example.com/", rendered)).toBeNull();
  });

  it("resolves a static render's links against its page", () => {
    expect(resolveLink("/docs/a.html", "b.html")).toBe("/docs/b.html");
    expect(resolveLink("/docs/a.html", "../index.html")).toBe("/index.html");
    expect(resolveLink("/a.html", "https://example.com/")).toBeNull();
  });

  it("renders HTML and Markdown, and opens a new, empty file as code", () => {
    expect(renderedKind("site/index.HTML")).toBe("html");
    expect(renderedKind("README.md")).toBe("markdown");
    expect(renderedKind("app.ts")).toBeNull();
    expect(openingMode(undefined, false)).toBe("rendered");
    expect(openingMode(undefined, true)).toBe("code");
    expect(openingMode("rendered", true)).toBe("rendered");
  });
});

describe("history", () => {
  const a = { path: "/a", port: null };
  const b = { path: "/b", port: null };
  const c = { path: "/c", port: null };
  const go = (history: BrowserHistory | null, page = a) =>
    browserHistory(history, { page, type: "navigate" });

  it("goes back and forward, and a new page drops what was ahead", () => {
    let history = go(go(go(null), b), c);
    expect(currentPage(history)).toEqual(c);
    history = browserHistory(history, { type: "back" });
    history = browserHistory(history, { type: "back" });
    expect(currentPage(history)).toEqual(a);
    expect(canGoBack(history)).toBe(false);
    expect(canGoForward(history)).toBe(true);
    history = browserHistory(history, { type: "forward" });
    expect(currentPage(history)).toEqual(b);
    history = go(history, c);
    history = go(history, a);
    expect(history?.entries).toEqual([a, b, c, a]);
    expect(canGoForward(history)).toBe(false);
  });

  it("counts every load, so the same page loads again", () => {
    const first = go(null);
    const again = go(first);
    expect(again?.entries).toEqual([a]);
    expect(again?.loads).toBe(1);
    expect(browserHistory(again, { type: "reload" })?.loads).toBe(2);
    // Nowhere to go: nothing changes.
    expect(browserHistory(again, { type: "back" })).toBe(again);
    expect(browserHistory(null, { type: "reload" })).toBeNull();
  });
});
