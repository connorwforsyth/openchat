import { DEFAULT_SITE_ORIGINS } from "@workspace/config/sites";
import { z } from "zod";
import {
  type ArtifactCheck,
  defineArtifactKind,
  defineOperation,
} from "../../define";
import { stackOffered } from "./checks";
import {
  DEFAULT_SITE_STACK,
  SITE_ENTRY,
  SITE_EXTENSIONS,
  SITE_LIMITS,
  type SiteContent,
  type SiteStackId,
  siteContentSchema,
} from "./content";
import { availableSiteStacks, SITE_STACKS } from "./stacks";

// The Site kind (125): a small static website, built on a stack
// (`./stacks.ts`), previewed by the artifact runtime and published to a
// link on its origin. Like a skill under the hood: its instructions and its
// stack's design guide are what the model is told whenever it may make one,
// and its checks hold whether or not it listened.

export interface SiteKindOptions {
  /** The public origins sites may load from (`artifacts.kinds.site.allowedOrigins`). */
  readonly allowedOrigins?: readonly string[];
  /** The stack the model is told to use (`artifacts.kinds.site.stack`). */
  readonly stack?: SiteStackId;
}

/** What the model is told about sites, for this instance's settings. */
export const siteInstructions = ({
  allowedOrigins,
  stack,
}: Required<SiteKindOptions>): string =>
  [
    "## Sites",
    "",
    `A site is a small static website the user can preview beside the chat and publish to a public link. Make one with \`create_artifact\`, type "site", when they want a web page or a few linked pages to share; change it with \`update_artifact\`, sending the whole site again. The content is JSON text:`,
    "",
    `{"stack": "${stack}", "files": {"${SITE_ENTRY}": "<!doctype html>…", "about.html": "…", "logo.svg": "<svg…"}}`,
    "",
    `- \`${SITE_ENTRY}\` is the home page. Up to ${SITE_LIMITS.files} files (.${SITE_EXTENSIONS.join(", .")}), in folders if you like. Link pages and files with relative paths (\`about.html\`, \`img/logo.svg\`), never ones starting with \`/\`.`,
    "- Tailwind is built in: use its classes, and don't load Tailwind from a CDN.",
    `- Fonts, styles, scripts and images may load only from ${allowedOrigins.length > 0 ? allowedOrigins.join(", ") : "the site's own files"}. Anything else is blocked.`,
    "- No network calls (fetch, XHR, WebSockets) and no storage (localStorage, cookies): a site has neither, so keep its data in the page.",
    "- If a save fails its checks, the result says what to fix.",
    "",
    SITE_STACKS[stack].design,
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
 * The Site kind for an instance's settings: its public origins and its
 * stack. With none given, the defaults (`DEFAULT_SITE_ORIGINS`, html-tailwind).
 */
export const siteKind = ({
  allowedOrigins = DEFAULT_SITE_ORIGINS,
  stack = DEFAULT_SITE_STACK,
}: SiteKindOptions = {}) => {
  const offered = availableSiteStacks();
  const stackChecks = (content: SiteContent): ArtifactCheck<SiteContent>[] =>
    offered.includes(content.stack)
      ? [...SITE_STACKS[content.stack].checks({ allowedOrigins })]
      : [];
  return defineArtifactKind<SiteContent>({
    capabilities: {
      aiCalls: false,
      annotate: false,
      present: false,
      share: true,
    },
    checks: [
      stackOffered(offered),
      // The rest are the site's stack's own.
      {
        name: "stack-checks",
        run: (content) =>
          stackChecks(content).flatMap((check) => check.run(content)),
      },
    ],
    content: siteContentSchema,
    diff: "text",
    editor: "none",
    export: [{ extension: "json", format: "file" }],
    // A page on a screen; `GlobeIcon` is the single-page HTML kind.
    icon: "MonitorIcon",
    instructions: siteInstructions({ allowedOrigins, stack }),
    kind: "site",
    label: "Site",
    operations: { replace: replaceSite },
    render: { panel: "source", runtime: "site" },
    starter: { badge: "beta" },
    thumbnail: "runtime",
  });
};
