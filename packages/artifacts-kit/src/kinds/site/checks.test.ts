import { DEFAULT_SITE_ORIGINS } from "@workspace/config/sites";
import { describe, expect, it } from "vitest";
import { checkArtifact } from "../../define";
import { instanceArtifactKinds } from "../../instance";
import { SITE_LIMITS } from "./content";
import { siteKind } from "./kind";

// The Site kind's checks (125), through `checkArtifact` as a save runs them:
// the content's shape first, then the pages' rules.

const BAD_PATH = /^files\.\.\.\/x\.html isn't a file path a site can have/;
const site = siteKind();
const page = (body: string, head = "") =>
  `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
const json = (files: Record<string, string>) => JSON.stringify({ files });
const check = (files: Record<string, string>) =>
  checkArtifact(site, json(files));

describe("the Site kind's checks", () => {
  it("accept a plain site", () => {
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
    });
  });

  it("say content that isn't JSON of the right shape is wrong, before anything else", () => {
    expect(checkArtifact(site, "<html></html>")).toEqual([
      'content isn\'t JSON. A site is {"files": {"index.tsx": "…"}}',
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
      "has no home page: every site needs index.tsx or index.html",
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
});

const HOME_TSX = [
  'import { useState } from "react";',
  'import { FeatureGrid, Hero, Page } from "@workspace/site-ui";',
  "export default function Home() {",
  '  return <Page><Hero title="Hi" actions={[{ label: "About", href: "about.html" }]} /><FeatureGrid features={[]} /><img src="logo.svg" alt="" /></Page>;',
  "}",
].join("\n");

describe("the Site kind's checks on TSX pages (163)", () => {
  it("accept a page built from site-ui, linking another TSX page by its .html name", () => {
    expect(
      check({
        "about.tsx":
          'import { Page } from "@workspace/site-ui";\nexport default () => <Page><a href="index.html">Home</a></Page>;',
        "index.tsx": HOME_TSX,
        "logo.svg": "<svg xmlns='http://www.w3.org/2000/svg'></svg>",
      })
    ).toEqual([]);
  });

  it("want one home page, and one file per page", () => {
    expect(
      check({
        "about.html": page(""),
        "index.html": page(""),
        "index.tsx": HOME_TSX,
        "logo.svg": "<svg/>",
      })
    ).toEqual([
      "has both index.tsx and index.html: a site has one home page, so keep one of them",
    ]);
    expect(
      check({
        "about.html": page(""),
        "about.tsx": HOME_TSX.replace("Home", "About"),
        "index.tsx": HOME_TSX,
        "logo.svg": "<svg/>",
      })
    ).toEqual([
      "has both about.tsx and about.html, which would be the same page: keep one of them",
    ]);
  });

  it("name imports a page can't use and components site-ui doesn't have", () => {
    const problems = check({
      "index.tsx": [
        'import confetti from "canvas-confetti";',
        'import { Hero, Bogus, type HeroProps } from "@workspace/site-ui";',
        'import * as UI from "@workspace/site-ui";',
        'import "./site.css";',
        "export default function Home() { return <Hero title='x' />; }",
      ].join("\n"),
    });
    expect(problems).toEqual([
      expect.stringContaining(
        'index.tsx imports "canvas-confetti", which a page can\'t use. A TSX page imports only "react", "react/jsx-runtime", "@workspace/site-ui"'
      ),
      expect.stringContaining(
        'index.tsx imports "./site.css", which a page can\'t use.'
      ),
      "index.tsx: Bogus isn't a site-ui component. It has: Cta, Faq, FeatureGrid, Footer, Hero, Nav, Page, Pricing, Prose, Section, Stats, Testimonial",
      'index.tsx imports all of "@workspace/site-ui" at once; import the blocks by name, like import { Hero, FeatureGrid } from "@workspace/site-ui"',
    ]);
  });

  it("want the page as the default export, and keep it off the network", () => {
    expect(
      check({
        "index.tsx":
          'import { Page } from "@workspace/site-ui";\nexport function Home() { fetch("x"); return <Page />; }',
      })
    ).toEqual([
      "index.tsx has no default export: export the page as `export default function Home() { return <Page>…</Page>; }`",
      "index.tsx uses fetch(): sites have no network and no storage, so keep data in the page itself",
    ]);
  });

  it("check a page's links and images, in tags and in props", () => {
    expect(
      check({
        "index.tsx":
          'import { Nav, Page } from "@workspace/site-ui";\nexport default () => <Page><Nav brand="x" label="Main" links={[{ label: "Gone", href: "gone.html" }]} /><img src="https://evil.example/p.png" alt="" /></Page>;',
      })
    ).toEqual([
      'index.tsx refers to "gone.html", which isn\'t a file in the site',
      `index.tsx loads "https://evil.example/p.png", which is blocked: sites may load only from ${DEFAULT_SITE_ORIGINS.join(", ")}`,
    ]);
  });
});

describe("an instance's kinds", () => {
  it("carry its site settings, or leave sites out when they're off", () => {
    const kinds = instanceArtifactKinds({
      site: {
        allowedOrigins: ["https://cdn.example.com"],
        enabled: true,
        // Deprecated (163), and ignored.
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
      site: { allowedOrigins: [], enabled: false },
    });
    expect(off.kinds).not.toContain("site");
    expect(off.kinds).toContain("html");
    expect(off.check("site", json({ "index.html": page("") }))).toEqual([
      '"site" isn\'t an artifact kind here',
    ]);
  });
});
