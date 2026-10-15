import { importSpecifiers } from "../../checks";

// TSX pages (163): what a page may import, read from its source. A page is
// built from `@workspace/site-ui`'s blocks and React, and nothing else: the
// runtime's require table (`apps/artifacts/src/site-runtime.ts`) holds just
// these modules, so naming the rest at save time saves a broken preview.

/** The modules a TSX page may import. */
export const SITE_TSX_MODULES = [
  "react",
  "react/jsx-runtime",
  "@workspace/site-ui",
] as const;

export const SITE_UI_MODULE = "@workspace/site-ui";

/**
 * The components `@workspace/site-ui` exports, as a page imports them. The
 * kit doesn't depend on the package (it's pure, and the package is React),
 * so site-ui's tests keep this equal to its real exports.
 */
export const SITE_UI_EXPORTS = [
  "Cta",
  "Faq",
  "FeatureGrid",
  "Footer",
  "Hero",
  "Nav",
  "Page",
  "Pricing",
  "Prose",
  "Section",
  "Stats",
  "Testimonial",
] as const;

/** One import statement's bindings from a module. */
export interface TsxImport {
  /** The names in `{ … }`, as exported (`B` in `B as C`); types left out. */
  readonly names: readonly string[];
  readonly specifier: string;
  /** `import X from` or `import * as X from`: a whole-module binding. */
  readonly whole: boolean;
}

const IMPORT_CLAUSE =
  /\bimport\s+(type\s+)?([\w$*\s{},]*?)\s*from\s*(["'])([^"'\n]+)\3/g;
const RENAMED = /\s+as\s+/;
const TRAILING_COMMA = /,\s*$/;
const NAMED = /\{([^}]*)\}/;
const WHOLE = /^\s*(?:\*\s*as\s+[\w$]+|[\w$]+)\s*(?:,|$)/;

/** Every import statement of `source` with what it binds. A scan, not a parse. */
export const tsxImports = (source: string): readonly TsxImport[] =>
  [...source.matchAll(IMPORT_CLAUSE)]
    .filter((match) => match[1] === undefined)
    .map((match) => {
      const clause = match[2] ?? "";
      const named = NAMED.exec(clause)?.[1] ?? "";
      return {
        names: named
          .split(",")
          .map((part) => part.trim())
          .filter((part) => part !== "" && !part.startsWith("type "))
          .map((part) => part.split(RENAMED)[0]?.trim() ?? part),
        specifier: match[4] ?? "",
        whole: WHOLE.test(
          clause.replace(NAMED, "").replace(TRAILING_COMMA, "")
        ),
      };
    });

const allowedModules = new Set<string>(SITE_TSX_MODULES);
const siteUiNames = new Set<string>(SITE_UI_EXPORTS);
const DEFAULT_EXPORT = /\bexport\s+default\b/;

/** What's wrong with a TSX page's imports and exports, as sentences the model can act on. */
export const tsxPageProblems = (path: string, source: string): string[] => {
  const problems = new Set<string>();
  const modules = SITE_TSX_MODULES.map((name) => `"${name}"`).join(", ");
  for (const specifier of importSpecifiers(source)) {
    if (!allowedModules.has(specifier)) {
      problems.add(
        `${path} imports "${specifier}", which a page can't use. A TSX page imports only ${modules}; put styles in Tailwind classes and pictures in .svg files`
      );
    }
  }
  for (const binding of tsxImports(source)) {
    if (binding.specifier !== SITE_UI_MODULE) {
      continue;
    }
    if (binding.whole) {
      problems.add(
        `${path} imports all of "${SITE_UI_MODULE}" at once; import the blocks by name, like import { Hero, FeatureGrid } from "${SITE_UI_MODULE}"`
      );
    }
    for (const name of binding.names) {
      if (!siteUiNames.has(name)) {
        problems.add(
          `${path}: ${name} isn't a site-ui component. It has: ${SITE_UI_EXPORTS.join(", ")}`
        );
      }
    }
  }
  if (!DEFAULT_EXPORT.test(source)) {
    problems.add(
      `${path} has no default export: export the page as \`export default function Home() { return <Page>…</Page>; }\``
    );
  }
  return [...problems];
};
