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

const SCRIPT_END = /<\/script>/g;

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

  it("builds each TSX page as an .html shell that hands the compiled page to the runtime (163)", async () => {
    const tsx = {
      candidates: ["from-site-ui"],
      // Stands in for Sucrase: what matters is where its output goes.
      compile: (source: string, path: string) =>
        `/* ${path} */ exports.default = ${JSON.stringify(source)}; // </script><!-- x`,
      runtimeUrl: "https://runtime.example/site-runtime-abc.js",
    };
    const site = {
      files: {
        "about.html": "<!doctype html><html><head></head><body></body></html>",
        "index.tsx": 'export default () => <p className="text-primary" />;',
      },
    };
    const targets = ["preview", "published"] as const;
    const builds = await Promise.all(
      targets.map((target) =>
        buildSite(site, { compile: fakeCompile, themeCss, tsx }, target)
      )
    );
    for (const [at, built] of builds.entries()) {
      const target = targets[at];
      expect(Object.keys(built.files).sort()).toEqual([
        "about.html",
        "index.html",
      ]);
      const index = built.files["index.html"];
      expect(index).toContain('<div id="root"></div>');
      expect(index).toContain(
        'import { mountPage } from "https://runtime.example/site-runtime-abc.js";\nmountPage((require, module, exports) => {\n/* index.tsx */'
      );
      expect(index).toContain('}, {"page":"index.html"});</script>');
      // Neither closes the script nor opens an escaped state.
      expect(index).toContain("// \\x3C/script>\\x3C!-- x");
      expect(index?.match(SCRIPT_END)?.length).toBe(
        target === "preview" ? 2 : 1
      );
      // The TSX's own classes and site-ui's are compiled.
      expect(built.css).toContain("text-primary");
      expect(built.css).toContain("from-site-ui");
    }
    expect(builds[0]?.files["index.html"]).toContain(
      'const pages = new Set(["about.html","index.html"]);'
    );
  });

  it("leaves site-ui's words out of a site with no TSX pages, and can't build TSX without the port", async () => {
    const tsx = {
      candidates: ["from-site-ui"],
      compile: () => "",
      runtimeUrl: "/site-runtime.js",
    };
    const built = await buildSite(
      content,
      { compile: fakeCompile, themeCss, tsx },
      "published"
    );
    expect(built.css).not.toContain("from-site-ui");
    await expect(
      buildSite(
        { files: { "index.tsx": "export default () => null;" } },
        { compile: fakeCompile, themeCss },
        "published"
      )
    ).rejects.toThrow(
      "index.tsx is a TSX page, and this runtime can't build them"
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
