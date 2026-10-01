// The public origins a site may load resources from (125): fonts, styles,
// scripts and images. Everything else is blocked by the site's CSP
// (`./csp.ts`), and the site checks say so before it's saved
// (`./checks.ts`). The instance's admins set the list in app.config.yaml
// (`artifacts.kinds.site.allowedOrigins`); the defaults and what counts as
// an entry live with that setting, in `@workspace/config/sites`.

import { isSiteOrigin } from "@workspace/config/sites";

const ABSOLUTE = /^(?:[a-z][a-z0-9+.-]*:)?\/\//i;

/** Whether `reference` leaves the site: a URL with a scheme or `//host`. */
export const isExternal = (reference: string): boolean =>
  ABSOLUTE.test(reference.trim());

/**
 * The origin `reference` would load from, as the browser resolves it on an
 * `https` page (`//host` is `https://host`); `null` for anything that
 * isn't an absolute `http(s)` URL.
 */
export const originOf = (reference: string): string | null => {
  const trimmed = reference.trim();
  const absolute = trimmed.startsWith("//") ? `https:${trimmed}` : trimmed;
  if (!URL.canParse(absolute)) {
    return null;
  }
  const url = new URL(absolute);
  return url.protocol === "https:" || url.protocol === "http:"
    ? url.origin
    : null;
};

/** Whether `origin` (as `originOf` gives it) is on `allowed`. */
export const originAllowed = (
  origin: string,
  allowed: readonly string[]
): boolean => {
  const url = new URL(origin);
  if (url.protocol !== "https:") {
    return false;
  }
  return allowed.some((entry) => {
    if (!isSiteOrigin(entry)) {
      return false;
    }
    const wildcard = entry.startsWith("https://*.");
    const pattern = new URL(entry.replace("*.", ""));
    if (pattern.port !== url.port) {
      return false;
    }
    return wildcard
      ? url.hostname.endsWith(`.${pattern.hostname}`)
      : url.hostname === pattern.hostname;
  });
};
