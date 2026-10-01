import { isSiteOrigin } from "@workspace/config/sites";

// A site's Content Security Policy (125). Sites are "locked down except for
// an allowlist": their own files, inline code (what a hand-written page
// has), and fonts, styles, scripts and images from the instance's public
// origins. No network calls, no forms, no plugins, and `sandbox` gives the
// page an opaque origin, so it has no cookies or storage on the artifacts
// origin to read even when opened on its own.

/** What would end a source list and start another directive. */
const SEPARATOR = /[\s;,]/;

export interface SiteCspOptions {
  /** The public origins it may load from (`artifacts.kinds.site.allowedOrigins`). */
  readonly allowedOrigins: readonly string[];
  /** Who may frame it: the app's origins for a preview, none for a published page. */
  readonly frameAncestors: readonly string[];
  /**
   * `preview`: the runtime's site page, which draws the site in a nested
   * `srcdoc` frame. `published`: a page of a published site, opened on its
   * own, which may open links in a new tab.
   */
  readonly mode: "preview" | "published";
}

/**
 * The policy, as a header value. Entries that aren't site origins are
 * dropped, so a malformed config can't smuggle in a directive.
 */
export const siteContentSecurityPolicy = ({
  allowedOrigins,
  frameAncestors,
  mode,
}: SiteCspOptions): string => {
  const origins = [...new Set(allowedOrigins.filter(isSiteOrigin))];
  const from = (...sources: readonly string[]) =>
    [...sources, ...origins].join(" ");
  const ancestors = frameAncestors.filter((origin) => !SEPARATOR.test(origin));
  return [
    "default-src 'none'",
    `script-src ${from("'self'", "'unsafe-inline'")}`,
    `style-src ${from("'self'", "'unsafe-inline'")}`,
    `font-src ${from("'self'", "data:")}`,
    `img-src ${from("'self'", "data:", "blob:")}`,
    `media-src ${from("'self'", "data:", "blob:")}`,
    "connect-src 'none'",
    // The preview draws pages in a `srcdoc` frame; a site embeds nothing.
    `frame-src ${mode === "preview" ? "'self'" : "'none'"}`,
    "object-src 'none'",
    "worker-src 'none'",
    "manifest-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    `frame-ancestors ${ancestors.length > 0 ? ancestors.join(" ") : "'none'"}`,
    mode === "preview"
      ? "sandbox allow-scripts"
      : "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox",
  ].join("; ");
};
