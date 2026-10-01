import { z } from "zod";

// Where a link or a `window.open` from the instance may go (D24). The window
// only ever shows the instance; everything else opens in the system browser,
// and only for schemes a browser should handle.

export const navigationDecisionSchema = z.enum(["allow", "external", "deny"]);
export type NavigationDecision = z.infer<typeof navigationDecisionSchema>;

const EXTERNAL_PROTOCOLS = new Set(["https:", "http:", "mailto:"]);

export const decideNavigation = (
  target: string,
  instanceOrigin: string | null
): NavigationDecision => {
  if (!URL.canParse(target)) {
    return "deny";
  }
  const url = new URL(target);
  if (instanceOrigin !== null && url.origin === instanceOrigin) {
    return "allow";
  }
  return EXTERNAL_PROTOCOLS.has(url.protocol) ? "external" : "deny";
};

/**
 * Web permissions the instance may use without asking: writing to the
 * clipboard (copy buttons) and fullscreen. Camera, microphone, location,
 * notifications and the rest are denied until a feature needs them and the
 * shell can ask the person first.
 */
const GRANTED = new Set(["clipboard-sanitized-write", "fullscreen"]);

export const decidePermission = (
  permission: string,
  requestingUrl: string,
  instanceOrigin: string | null
): boolean =>
  GRANTED.has(permission) &&
  decideNavigation(requestingUrl, instanceOrigin) === "allow";
