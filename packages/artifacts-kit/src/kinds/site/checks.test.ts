import { DEFAULT_SITE_ORIGINS } from "@workspace/config/sites";
import { describe, expect, it } from "vitest";
import { checkArtifact } from "../../define";
import { instanceArtifactKinds } from "../../instance";
import { SITE_LIMITS } from "./content";
import { siteKind } from "./kind";

// The Site kind's checks (125), through `checkArtifact` as a save runs them:
// the content's shape first, then the stack's rules.

const BAD_PATH = /^files\.\.\.\/x\.html isn't a file path a site can have/;
const site = siteKind();
const page = (body: string, head = "") =>
  `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
const json = (files: Record<string, string>, stack?: string) =>
  JSON.stringify(stack ? { files, stack } : { files });
const check = (files: Record<string, string>, stack?: string) =>
  checkArtifact(site, json(files, stack));

describe("the Site kind's checks", () => {
  it("accept a plain site, defaulting its stack", () => {
    expect(
      check({
        "about.html": page('<a href="index.html">Home</a>'),
        "css/site.css":
          "body { margin: 0; } .hero { background: url(../img/bg.svg); }",
        "img/bg.svg": "<svg xmlns='http://www.w3.org/2000/svg'></svg>",
        "index.html": page(
          '<h1 class="text-foreground">Hi</h1><a href="about.html#team">About</a><a href="https://example.com">Out</a><img src="img/bg.svg" alt="">',
          '<link rel="stylesheet" href="css/site.css"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">'
        ),
      })
    ).toEqual([]);
    expect(site.content.parse(json({ "index.html": page("") }))).toEqual({
      files: { "index.html": page("") },
      stack: "html-tailwind",
    });
  });

  it("say content that isn't JSON of the right shape is wrong, before anything else", () => {
    expect(checkArtifact(site, "<html></html>")).toEqual([
      'content isn\'t JSON. A site is {"stack": "html-tailwind", "files": {"index.html": "…"}}',
    ]);
    expect(checkArtifact(site, json({ "../x.html": "<p>" }))).toEqual([
      expect.stringMatching(BAD_PATH),
    ]);
    expect(checkArtifact(site, json({ "/abs.html": "<p>" }))).toHaveLength(1);
    expect(checkArtifact(site, json({ "img.png": "x" }))).toHaveLength(1);
    expect(checkArtifact(site, json({ ".env.txt": "x" }))).toHaveLength(1);
  });

  it("need a home page, at most the file and size limits, and HTML pages", () => {
    expect(check({ "about.html": page("") })).toEqual([
      "has no index.html: every site needs a home page there",
    ]);
    const many = Object.fromEntries(
      Array.from({ length: SITE_LIMITS.files + 1 }, (_, index) => [
        index === 0 ? "index.html" : `p${index}.txt`,
        index === 0 ? page("") : "x",
      ])
    );
    expect(check(many)).toEqual([
      `has ${SITE_LIMITS.files + 1} files; a site may have at most ${SITE_LIMITS.files}`,
    ]);
    expect(
      check({ "index.html": page("x".repeat(SITE_LIMITS.chars)) })
    ).toEqual([
      `is longer than ${SITE_LIMITS.chars} characters in all; make it smaller`,
    ]);
    expect(check({ "index.html": "just text" })).toEqual([
      "index.html isn't an HTML page",
    ]);
  });

  it("find links and resources that aren't in the site, or are rooted at /", () => {
    expect(
      check({
        "index.html": page(
          '<a href="missing.html">x</a><img src="/logo.svg" alt=""><script src="app.js"></script>'
        ),
      })
    ).toEqual([
      'index.html refers to "missing.html", which isn\'t a file in the site',
      'index.html refers to "/logo.svg"; use a relative path (like "logo.svg"), since a published site doesn\'t live at the root',
      'index.html refers to "app.js", which isn\'t a file in the site',
    ]);
    expect(
      check({
        "docs/index.html": page('<a href="../">Up</a><a href="./">Here</a>'),
        "index.html": page('<a href="docs/">Docs</a>'),
      })
    ).toEqual([]);
  });

  it("block resources from origins that aren't allowed, but not links", () => {
    expect(
      check({
        "app.js":
          'import confetti from "https://evil.example/confetti.js";\nimport x from "lodash";',
        "index.html": page(
          '<a href="https://evil.example">fine</a><img src="https://evil.example/p.png" alt=""><div style="background: url(//evil.example/bg.png)"></div><script type="module" src="app.js"></script>',
          '<script src="https://cdn.jsdelivr.net/npm/alpinejs@3"></script><link rel="stylesheet" href="http://fonts.googleapis.com/css">'
        ),
      })
    ).toEqual([
      `app.js loads "https://evil.example/confetti.js", which is blocked: sites may load only from ${DEFAULT_SITE_ORIGINS.join(", ")}`,
      `app.js imports "lodash", which a browser can't resolve: import a full https URL from ${DEFAULT_SITE_ORIGINS.join(", ")}, or a relative path`,
      `index.html loads "http://fonts.googleapis.com/css", which is blocked: sites may load only from ${DEFAULT_SITE_ORIGINS.join(", ")}`,
      `index.html loads "https://evil.example/p.png", which is blocked: sites may load only from ${DEFAULT_SITE_ORIGINS.join(", ")}`,
      `index.html loads "//evil.example/bg.png", which is blocked: sites may load only from ${DEFAULT_SITE_ORIGINS.join(", ")}`,
    ]);
  });

  it("follow the instance's allowlist, wildcards included", () => {
    const narrow = siteKind({ allowedOrigins: ["https://*.example.org"] });
    const files = {
      "index.html": page(
        '<img src="https://img.example.org/a.svg" alt=""><img src="https://example.org/b.svg" alt="">'
      ),
    };
    expect(checkArtifact(narrow, json(files))).toEqual([
      'index.html loads "https://example.org/b.svg", which is blocked: sites may load only from https://*.example.org',
    ]);
    const none = siteKind({ allowedOrigins: [] });
    expect(
      checkArtifact(
        none,
        json({
          "index.html": page('<img src="https://fonts.gstatic.com/x" alt="">'),
        })
      )
    ).toEqual([
      'index.html loads "https://fonts.gstatic.com/x", which is blocked: sites may load only from their own files',
    ]);
  });

  it("refuse scripts that reach for the network or storage", () => {
    expect(
      check({
        "app.js": "localStorage.setItem('a', 1); document.cookie = 'x';",
        "index.html": page(
          '<script>fetch("/api").then(() => new WebSocket("wss://x"));</script><script src="app.js"></script>'
        ),
      })
    ).toEqual([
      "app.js uses localStorage, document.cookie: sites have no network and no storage, so keep data in the page itself",
      "index.html uses fetch(), WebSocket: sites have no network and no storage, so keep data in the page itself",
    ]);
  });

  it("refuse the react-ui stack, which isn't built yet", () => {
    expect(check({ "index.html": page("") }, "react-ui")).toEqual([
      'the "react-ui" stack isn\'t available here. Use "html-tailwind"',
    ]);
    expect(check({ "index.html": page("") }, "vue")).toHaveLength(1);
  });
});

describe("an instance's kinds", () => {
  it("carry its site settings, or leave sites out when they're off", () => {
    const kinds = instanceArtifactKinds({
      site: {
        allowedOrigins: ["https://cdn.example.com"],
        enabled: true,
        stack: "html-tailwind",
      },
    });
    expect(kinds.get("site")?.instructions).toContain(
      "https://cdn.example.com"
    );
    expect(
      kinds.check(
        "site",
        json({
          "index.html": page('<img src="https://fonts.gstatic.com/x" alt="">'),
        })
      )
    ).toHaveLength(1);
    const off = instanceArtifactKinds({
      site: { allowedOrigins: [], enabled: false, stack: "html-tailwind" },
    });
    expect(off.kinds).not.toContain("site");
    expect(off.kinds).toContain("html");
    expect(off.check("site", json({ "index.html": page("") }))).toEqual([
      '"site" isn\'t an artifact kind here',
    ]);
  });
});
