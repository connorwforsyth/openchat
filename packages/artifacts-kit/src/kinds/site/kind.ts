import { DEFAULT_SITE_ORIGINS } from "@workspace/config/sites";
import { z } from "zod";
import { defineArtifactKind, defineOperation } from "../../define";
import {
  localReferences,
  noNetworkOrStorage,
  pagesAreHtml,
  publicOriginsOnly,
  siteShape,
  tsxPages,
} from "./checks";
import {
  SITE_EXTENSIONS,
  SITE_LIMITS,
  type SiteContent,
  siteContentSchema,
} from "./content";
import { DESIGN_GUIDES } from "./design/generated";

// The Site kind (125): a small static website, previewed by the artifact
// runtime and published to a link on its origin. Like a skill under the
// hood: its instructions and design guides are what the model is told
// whenever it may make one, and its checks hold whether or not it
// listened. Pages are TSX built from `@workspace/site-ui` (163), the
// default, or HTML styled with Tailwind; the kind is the binding, so there
// are no stacks to choose between.

export interface SiteKindOptions {
  /** The public origins sites may load from (`artifacts.kinds.site.allowedOrigins`). */
  readonly allowedOrigins?: readonly string[];
}

/** What the model is told about sites, for this instance's settings. */
export const siteInstructions = ({
  allowedOrigins,
}: Required<SiteKindOptions>): string =>
  [
    "## Sites",
    "",
    `A site is a small static website the user can preview beside the chat and publish to a public link. Make one with \`create_artifact\`, type "site", when they want a web page or a few linked pages to share; change it with \`update_artifact\`, sending the whole site again. The content is JSON text:`,
    "",
    `{"files": {"index.tsx": "import { Page, Hero } from \\"@workspace/site-ui\\";…", "about.tsx": "…", "logo.svg": "<svg…"}}`,
    "",
    "- Write pages as TSX built from `@workspace/site-ui`'s blocks (the design guide below): it's the fastest way to a page that looks right. `about.tsx` is served as `about.html`, so link pages by their `.html` names. Plain `.html` pages styled with Tailwind work too.",
    `- \`index.tsx\` (or \`index.html\`, not both) is the home page. Up to ${SITE_LIMITS.files} files (.${SITE_EXTENSIONS.join(", .")}), in folders if you like. Link pages and files with relative paths (\`about.html\`, \`img/logo.svg\`), never ones starting with \`/\`.`,
    "- Tailwind is built in: use its classes, and don't load Tailwind from a CDN.",
    `- Fonts, styles, scripts and images may load only from ${allowedOrigins.length > 0 ? allowedOrigins.join(", ") : "the site's own files"}. Anything else is blocked.`,
    "- No network calls (fetch, XHR, WebSockets) and no storage (localStorage, cookies): a site has neither, so keep its data in the page.",
    "- If a save fails its checks, the result says what to fix.",
    "",
    DESIGN_GUIDES["site-ui"],
    "",
    DESIGN_GUIDES["html-tailwind"],
  ].join("\n");

/** Replaces the whole site, like the text kinds' `replace`. */
const replaceSite = defineOperation({
  apply: (
    _current: SiteContent | null,
    input: { readonly content: SiteContent }
  ) => input.content,
  description: "Replace the whole site.",
  input: z.object({ content: siteContentSchema }),
});

/**
 * The Site kind for an instance's public origins; with none given, the
 * defaults (`DEFAULT_SITE_ORIGINS`).
 */
export const siteKind = ({
  allowedOrigins = DEFAULT_SITE_ORIGINS,
}: SiteKindOptions = {}) =>
  defineArtifactKind<SiteContent>({
    capabilities: {
      aiCalls: false,
      annotate: false,
      present: false,
      share: true,
    },
    checks: [
      siteShape,
      pagesAreHtml,
      tsxPages,
      localReferences,
      publicOriginsOnly(allowedOrigins),
      noNetworkOrStorage,
    ],
    content: siteContentSchema,
    diff: "text",
    editor: "none",
    export: [{ extension: "json", format: "file" }],
    // A page on a screen; `GlobeIcon` is the single-page HTML kind.
    icon: "MonitorIcon",
    instructions: siteInstructions({ allowedOrigins }),
    kind: "site",
    label: "Site",
    operations: { replace: replaceSite },
    render: { panel: "source", runtime: "site" },
  });
