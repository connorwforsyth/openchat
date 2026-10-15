import type { ArtifactCheck } from "../../define";
import {
  extensionOf,
  isTsxPage,
  pageOf,
  SITE_ENTRY_SOURCES,
  SITE_LIMITS,
  type SiteContent,
} from "./content";
import { isExternal, originAllowed, originOf } from "./origins";
import { fileReferences, inlineCode, resolveInSite } from "./scan";
import { tsxPageProblems } from "./tsx";

// The rules a site must pass to be saved (125). Each problem is a sentence
// the model reads and can fix. What they enforce, the CSP enforces again at
// render time (`./csp.ts`); the checks exist so the model hears about it
// before anyone opens a broken page.

type SiteCheck = ArtifactCheck<SiteContent>;

const filesOf = (content: SiteContent) => Object.entries(content.files);

/** Whether `target`, a built page or file, is in the site (`about.html` may be `about.tsx`). */
const inSite = (content: SiteContent, target: string): boolean =>
  content.files[target] !== undefined ||
  (extensionOf(target) === "html" &&
    content.files[`${target.slice(0, -"html".length)}tsx`] !== undefined);

/** There's one home page, each page is built from one file, and not too much. */
export const siteShape: SiteCheck = {
  name: "shape",
  run: (content) => {
    const files = filesOf(content);
    const chars = files.reduce(
      (sum, [path, text]) => sum + path.length + text.length,
      0
    );
    const homes = SITE_ENTRY_SOURCES.filter(
      (path) => content.files[path] !== undefined
    );
    const twins = files
      .map(([path]) => path)
      .filter(isTsxPage)
      .filter((path) => content.files[pageOf(path)] !== undefined)
      // The home page's pair is the line above's.
      .filter((path) => path !== "index.tsx");
    return [
      ...(homes.length === 0
        ? [
            `has no home page: every site needs ${SITE_ENTRY_SOURCES.join(" or ")}`,
          ]
        : []),
      ...(homes.length > 1
        ? [
            `has both ${SITE_ENTRY_SOURCES.join(" and ")}: a site has one home page, so keep one of them`,
          ]
        : []),
      ...twins.map(
        (path) =>
          `has both ${path} and ${pageOf(path)}, which would be the same page: keep one of them`
      ),
      ...(files.length > SITE_LIMITS.files
        ? [
            `has ${files.length} files; a site may have at most ${SITE_LIMITS.files}`,
          ]
        : []),
      ...(chars > SITE_LIMITS.chars
        ? [
            `is longer than ${SITE_LIMITS.chars} characters in all; make it smaller`,
          ]
        : []),
    ];
  },
};

const HTML_SHAPE = /<[a-z!][\s\S]*>/i;
const LEADING_SLASHES = /^\/+/;

/** Each page is HTML. */
export const pagesAreHtml: SiteCheck = {
  name: "pages",
  run: (content) =>
    filesOf(content)
      .filter(
        ([path, text]) => extensionOf(path) === "html" && !HTML_SHAPE.test(text)
      )
      .map(([path]) => `${path} isn't an HTML page`),
};

/**
 * Each TSX page imports only React and site-ui's blocks, by names site-ui
 * has, and exports its page (`./tsx.ts`).
 */
export const tsxPages: SiteCheck = {
  name: "tsx-pages",
  run: (content) =>
    filesOf(content)
      .filter(([path]) => isTsxPage(path))
      .flatMap(([path, text]) => tsxPageProblems(path, text)),
};

/**
 * Local references resolve: every relative link and resource names a file
 * the site has, and nothing is rooted at `/` (a published site lives under
 * its link's path, so `/about.html` would leave it).
 */
export const localReferences: SiteCheck = {
  name: "references",
  run: (content) =>
    filesOf(content).flatMap(([path, text]) => {
      const problems = new Set<string>();
      for (const reference of fileReferences(path, text)) {
        // A TSX page's imports are `tsxPages`' business.
        if (reference.kind === "module") {
          continue;
        }
        const target = resolveInSite(path, reference.url);
        if (target === "root") {
          problems.add(
            `${path} refers to "${reference.url}"; use a relative path (like "${reference.url.replace(LEADING_SLASHES, "") || "index.html"}"), since a published site doesn't live at the root`
          );
        } else if (
          target !== null &&
          !inSite(content, target) &&
          // A bare module name (`react`) is the next check's business.
          !(
            reference.kind === "resource" &&
            isScript(path) &&
            isBareSpecifier(reference.url)
          )
        ) {
          problems.add(
            `${path} refers to "${reference.url}", which isn't a file in the site`
          );
        }
      }
      return [...problems];
    }),
};

const isScript = (path: string): boolean =>
  ["js", "mjs"].includes(extensionOf(path));

const RELATIVE_OR_ABSOLUTE = /^(?:\.{0,2}\/|[a-z][a-z0-9+.-]*:)/i;

const isBareSpecifier = (specifier: string): boolean =>
  !(
    RELATIVE_OR_ABSOLUTE.test(specifier) ||
    isExternal(specifier) ||
    specifier.includes(".")
  );

/** Why one reference in `path` may not load, if it may not. */
const originProblem = (
  path: string,
  url: string,
  allowed: readonly string[]
): string | null => {
  if (isExternal(url)) {
    const origin = originOf(url);
    return origin !== null && originAllowed(origin, allowed)
      ? null
      : `${path} loads "${url}", which is blocked: sites may load only from ${allowed.length > 0 ? allowed.join(", ") : "their own files"}`;
  }
  return isScript(path) && isBareSpecifier(url)
    ? `${path} imports "${url}", which a browser can't resolve: import a full https URL from ${allowed.join(", ") || "an allowed origin"}, or a relative path`
    : null;
};

/**
 * Resources from outside the site come only from `allowed` public origins,
 * over https. Links to other sites are fine: following one leaves the site.
 */
export const publicOriginsOnly = (allowed: readonly string[]): SiteCheck => ({
  name: "origins",
  run: (content) =>
    filesOf(content).flatMap(([path, text]) => [
      ...new Set(
        fileReferences(path, text)
          .filter((reference) => reference.kind === "resource")
          .flatMap((reference) => {
            const problem = originProblem(path, reference.url, allowed);
            return problem === null ? [] : [problem];
          })
      ),
    ]),
});

/** The browser APIs a site can't use, and why, as the model reads it. */
const LOCKED_DOWN: readonly (readonly [RegExp, string])[] = [
  [/\blocalStorage\b/, "localStorage"],
  [/\bsessionStorage\b/, "sessionStorage"],
  [/\bindexedDB\b/, "indexedDB"],
  [/\bdocument\s*\.\s*cookie\b/, "document.cookie"],
  [/\bfetch\s*\(/, "fetch()"],
  [/\bXMLHttpRequest\b/, "XMLHttpRequest"],
  [/\bWebSocket\b/, "WebSocket"],
  [/\bEventSource\b/, "EventSource"],
  [/\bsendBeacon\b/, "navigator.sendBeacon"],
];

/**
 * Scripts don't reach for the network or storage: a site has neither (it
 * runs on an opaque origin with `connect-src 'none'`), so they'd only fail.
 */
export const noNetworkOrStorage: SiteCheck = {
  name: "browser-apis",
  run: (content) =>
    filesOf(content).flatMap(([path, text]) => {
      const extension = extensionOf(path);
      const scripts = isScript(path) || isTsxPage(path) ? [text] : [];
      if (extension === "html") {
        scripts.push(...inlineCode(text).scripts);
      }
      const used = LOCKED_DOWN.filter(([pattern]) =>
        scripts.some((script) => pattern.test(script))
      ).map(([, name]) => name);
      return used.length > 0
        ? [
            `${path} uses ${used.join(", ")}: sites have no network and no storage, so keep data in the page itself`,
          ]
        : [];
    }),
};
