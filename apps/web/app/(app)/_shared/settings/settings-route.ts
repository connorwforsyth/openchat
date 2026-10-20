import { idForSlug, type Terms } from "@workspace/config/terms";
import { z } from "zod";

import { routes } from "@/lib/routes";

// Settings is a full-screen view over whatever page you're on (185), so
// "Back to app" returns to exactly where you were. Its address is still
// `/settings/<section>`, so a section can be linked to: opening it pushes
// that address onto the history without a navigation (the page underneath
// stays put), switching sections replaces it, and closing goes back. A hard
// load of the address is a real route that renders the new-chat screen, with
// settings over it.
//
// A section's address segment is its id, except where `terms:` names the
// feature (191): `mcp` lives at `/settings/<terms.mcp.slug>`, and its old
// addresses (`/settings/connectors`, `/settings/mcp` when the slug differs)
// redirect there.

export const settingsSectionSchema = z.enum([
  "profile",
  "keys",
  "mcp",
  "memory",
  "shortcuts",
  "appearance",
]);

export type SettingsSection = z.infer<typeof settingsSectionSchema>;

export const DEFAULT_SETTINGS_SECTION: SettingsSection = "profile";

/**
 * What the address says about the view: closed (`null`), open on the
 * section list (`"index"`, `/settings`; wide screens show the default
 * section), or open on a section. An unknown section is closed: the route
 * renders its 404.
 */
export type SettingsRoute = SettingsSection | "index" | null;

const SETTINGS_PATH = /^\/settings(?:\/([^/]+))?\/?$/;

type Parsed =
  | { readonly kind: "closed" }
  | { readonly kind: "index" }
  | {
      readonly canonical: boolean;
      readonly kind: "section";
      readonly section: SettingsSection;
    };

const parse = (pathname: string, terms: Terms): Parsed => {
  const match = SETTINGS_PATH.exec(pathname);
  if (!match) {
    return { kind: "closed" };
  }
  if (match[1] === undefined) {
    return { kind: "index" };
  }
  const found = idForSlug(terms, settingsSectionSchema.options, match[1]);
  return found
    ? { canonical: found.canonical, kind: "section", section: found.id }
    : { kind: "closed" };
};

/** An old address still opens its section; the page redirects it too. */
export const settingsRouteFromPath = (
  pathname: string,
  terms: Terms
): SettingsRoute => {
  const parsed = parse(pathname, terms);
  switch (parsed.kind) {
    case "closed":
      return null;
    case "index":
      return "index";
    case "section":
      return parsed.section;
    default: {
      const unreachable: never = parsed;
      return unreachable;
    }
  }
};

/** Where an old address for a section now lives; `null` if it's current. */
export const settingsRedirect = (
  pathname: string,
  terms: Terms
): string | null => {
  const parsed = parse(pathname, terms);
  return parsed.kind === "section" && !parsed.canonical
    ? routes.settings(terms, parsed.section)
    : null;
};

/** The bit of `window.history` the view drives; a port, so tests can fake it. */
export interface SettingsHistory {
  readonly back: () => void;
  readonly pushState: (data: unknown, unused: string, url: string) => void;
  readonly replaceState: (data: unknown, unused: string, url: string) => void;
  readonly state: unknown;
}

/** Marks the history entry settings pushed, so closing knows it can go back. */
const OVERLAY_KEY = "settingsOverlay";

const pushedBySettings = (state: unknown): boolean =>
  typeof state === "object" &&
  state !== null &&
  (state as Record<string, unknown>)[OVERLAY_KEY] === true;

/** Opens the view over the current page. Already open: switches section. */
export const openSettings = (
  history: SettingsHistory,
  pathname: string,
  terms: Terms,
  section?: SettingsSection
): void => {
  if (settingsRouteFromPath(pathname, terms) !== null) {
    selectSettingsSection(history, terms, section);
    return;
  }
  history.pushState(
    { [OVERLAY_KEY]: true },
    "",
    routes.settings(terms, section)
  );
};

/** Another section, same history entry: Back still closes the view. */
export const selectSettingsSection = (
  history: SettingsHistory,
  terms: Terms,
  section?: SettingsSection
): void => {
  // Only our mark: passing the router's own state back makes Next treat the
  // call as its own and skip syncing `usePathname`.
  history.replaceState(
    pushedBySettings(history.state) ? { [OVERLAY_KEY]: true } : null,
    "",
    routes.settings(terms, section)
  );
};

/**
 * Back to the page underneath. Opened from a page: one step back. Loaded
 * from the address itself: the page underneath is the new chat, so the
 * address becomes `/` without a navigation.
 */
export const closeSettings = (history: SettingsHistory, home: string): void => {
  if (pushedBySettings(history.state)) {
    history.back();
    return;
  }
  history.replaceState(null, "", home);
};
