import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { buildSite, intoHead, tailwindCandidates } from "./build";
import { ruleBody, siteTailwindInput } from "./theme";

// Building a site (125). The compiler is faked here: what it's given is the
// point. apps/artifacts compiles real Tailwind over the real theme.

const themeCss = await readFile(
  new URL("../../../../ui/src/styles/globals.css", import.meta.url),
  "utf8"
);

const FONT_TOKEN = /^\s*--font-[\w-]+\s*:[^;]*;\s*$/gm;
const PUBLISHED_HEAD =
  /^<!doctype html><html lang="en"><head><style data-site-theme>\/\* \d+ \*\/ \.built\{\}/;

const fakeCompile = (input: string, candidates: readonly string[]) =>
  Promise.resolve(
    `/* ${input.length} */ .built{} /* ${candidates.join(" ")} */`
  );

describe("the instance theme, for sites", () => {
  it("takes the token blocks from globals.css, not a copy", () => {
    const input = siteTailwindInput(themeCss);
    expect(input.startsWith('@import "tailwindcss";')).toBe(true);
    expect(input).toContain(
      `@theme inline {${ruleBody(themeCss, "@theme inline")?.replace(FONT_TOKEN, "")}}`
    );
    expect(input).toContain(`:root {${ruleBody(themeCss, ":root")}}`);
    expect(input).toContain(
      `@media (prefers-color-scheme: dark) {\n  :root {${ruleBody(themeCss, ".dark")}}\n}`
    );
    expect(input).toContain("--color-primary: var(--primary);");
    // The app sets its fonts with its own loader; sites don't have it.
    expect(input).not.toContain("--font-sans: var(--font-sans)");
  });

  it("finds top-level rules only", () => {
    const css =
      "@media (x) { :root { --a: 1; } }\n:root { --b: 2; }\n.dark{--c:3}";
    expect(ruleBody(css, ":root")).toBe(" --b: 2; ");
    expect(ruleBody(css, ".dark")).toBe("--c:3");
    expect(ruleBody(css, ".light")).toBeNull();
  });
});

describe("building a site", () => {
  const content = {
    files: {
      "about.html":
        "<!doctype html><html><head><title>About</title></head><body><a href='index.html'>Home</a></body></html>",
      "app.js": "document.body.classList.add('bg-muted');",
      "index.html":
        '<!doctype html><html lang="en"><head><link rel="stylesheet" href="site.css"></head><body class="bg-background p-6"><img src="logo.svg" alt="Logo"><script type="module" src="app.js"></script><a href="about.html">About</a></body></html>',
      "logo.svg":
        "<svg xmlns='http://www.w3.org/2000/svg'><circle r='4'/></svg>",
      "site.css": "h1 { letter-spacing: -0.01em; } </style><script>",
    },
    stack: "html-tailwind" as const,
  };

  it("compiles Tailwind for the words its pages and scripts use", () => {
    const candidates = tailwindCandidates(content.files);
    expect(candidates).toEqual(
      expect.arrayContaining(["bg-background", "p-6", "bg-muted"])
    );
    // Stylesheets and SVGs aren't markup.
    expect(candidates).not.toContain("letter-spacing:");
  });

  it("puts the CSS at the top of each page's head, and leaves other files be, for a published link", async () => {
    const built = await buildSite(
      content,
      { compile: fakeCompile, themeCss },
      "published"
    );
    expect(built.files["index.html"]).toMatch(PUBLISHED_HEAD);
    expect(built.files["index.html"]).toContain(
      '<link rel="stylesheet" href="site.css">'
    );
    expect(built.files["site.css"]).toBe(content.files["site.css"]);
    expect(built.files["about.html"]).toContain(
      "<head><style data-site-theme>"
    );
  });

  it("writes local files into each page for a preview, and hands links to the runtime", async () => {
    const built = await buildSite(
      content,
      { compile: fakeCompile, themeCss },
      "preview"
    );
    const index = built.files["index.html"];
    expect(index).not.toContain('href="site.css"');
    // A stylesheet can't close its own <style>.
    expect(index).toContain(
      "<style>h1 { letter-spacing: -0.01em; } <\\/style><script></style>"
    );
    expect(index).toContain(
      `<script type="module" >document.body.classList.add('bg-muted');</script>`
    );
    expect(index).toContain('src="data:image/svg+xml;base64,');
    expect(index).toContain('"site-preview/1"');
    expect(index).toContain(
      'const pages = new Set(["about.html","index.html"]);'
    );
  });

  it("places markup in the head, or as near as a page has", () => {
    expect(intoHead("<html><head></head></html>", "X")).toBe(
      "<html><head>X</head></html>"
    );
    expect(intoHead("<html><body></body></html>", "X")).toBe(
      "<html>X<body></body></html>"
    );
    expect(intoHead("<!doctype html><p>", "X")).toBe("<!doctype html>X<p>");
    expect(intoHead("<p>", "X")).toBe("X<p>");
  });
});
