import type { ArtifactCheck } from "../../define";
import {
  localReferences,
  noNetworkOrStorage,
  pagesAreHtml,
  publicOriginsOnly,
  siteShape,
} from "./checks";
import type { SiteContent, SiteStackId } from "./content";
import { DESIGN_GUIDES } from "./design/generated";
import { SITE_THEME_COLORS } from "./theme";

// A site's stack (125): what it's built with, as a definition, so the
// stack is a setting rather than a fork in the code (Connor, 2026-10-01).
// Each stack says which libraries a site may use, which theme tokens it
// styles with, the design guide the model follows, its checks, and how it
// builds for showing and publishing.

export interface SiteStack {
  /**
   * Whether sites can use it yet. A stack that isn't is defined (so the
   * setting and the guide exist) but its checks refuse it.
   */
  readonly available: boolean;
  /** How it's built: Tailwind compiled over the theme, or React pre-rendered. */
  readonly build: "prerender-react" | "tailwind";
  /** The checks beyond the site's shape, given the instance's public origins. */
  readonly checks: (options: {
    readonly allowedOrigins: readonly string[];
  }) => readonly ArtifactCheck<SiteContent>[];
  /** The design guide the model is told (`design/<stack>.md`). */
  readonly design: string;
  readonly id: SiteStackId;
  readonly label: string;
  /**
   * What a site may use beyond its own files, as the model is told it.
   * Anything else must come from an allowed public origin.
   */
  readonly libraries: readonly string[];
  /** The theme's semantic colours it styles with. */
  readonly themeColors: readonly string[];
}

const commonChecks = (allowedOrigins: readonly string[]) => [
  siteShape,
  pagesAreHtml,
  localReferences,
  publicOriginsOnly(allowedOrigins),
  noNetworkOrStorage,
];

/** The default: plain HTML, CSS and a little JavaScript, styled with Tailwind. */
export const htmlTailwindStack: SiteStack = {
  available: true,
  build: "tailwind",
  checks: ({ allowedOrigins }) => commonChecks(allowedOrigins),
  design: DESIGN_GUIDES["html-tailwind"],
  id: "html-tailwind",
  label: "HTML and Tailwind",
  libraries: ["Tailwind CSS (built in, compiled when the site renders)"],
  themeColors: SITE_THEME_COLORS,
};

/**
 * React with the instance's UI kit, pre-rendered to static HTML when it's
 * published. Defined, not built yet: pre-rendering needs the UI kit bundled
 * for the runtime and a server render step, which is its own ticket.
 */
export const reactUiStack: SiteStack = {
  available: false,
  build: "prerender-react",
  checks: ({ allowedOrigins }) => commonChecks(allowedOrigins),
  design: DESIGN_GUIDES["react-ui"],
  id: "react-ui",
  label: "React and the UI kit",
  libraries: ["react", "react-dom", "@workspace/ui"],
  themeColors: SITE_THEME_COLORS,
};

export const SITE_STACKS: Readonly<Record<SiteStackId, SiteStack>> = {
  "html-tailwind": htmlTailwindStack,
  "react-ui": reactUiStack,
};

/** The stacks sites can use today. */
export const availableSiteStacks = (): readonly SiteStackId[] =>
  Object.values(SITE_STACKS)
    .filter((stack) => stack.available)
    .map((stack) => stack.id);
