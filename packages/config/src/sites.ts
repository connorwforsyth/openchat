// Sites (125): the instance's defaults for `artifacts.kinds.site`, and what
// counts as an entry in its allowlist. Here rather than in
// `@workspace/artifacts-kit` (which uses them) so the config schema can
// validate with them: the kit depends on config, not the other way round.

/**
 * The public origins sites may load from unless an admin says otherwise:
 * Google Fonts (the stylesheet and the font files), cdnjs and jsDelivr.
 */
export const DEFAULT_SITE_ORIGINS: readonly string[] = [
  "https://fonts.googleapis.com",
  "https://fonts.gstatic.com",
  "https://cdnjs.cloudflare.com",
  "https://cdn.jsdelivr.net",
];

/**
 * An allowlist entry: an `https` origin with no path, optionally with a
 * port, or `https://*.example.com` for every subdomain of a host (a CSP
 * host source, which is how the browser will read it).
 */
export const SITE_ORIGIN_PATTERN =
  /^https:\/\/(?:\*\.)?[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+(?::\d{1,5})?$/;

export const isSiteOrigin = (entry: string): boolean =>
  SITE_ORIGIN_PATTERN.test(entry);
