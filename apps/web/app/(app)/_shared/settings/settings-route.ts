import { z } from "zod";

// Settings is a full-screen view over whatever page you're on (185), so
// "Back to app" returns to exactly where you were. Its address is still
// `/settings/<section>`, so a section can be linked to: opening it pushes
// that address onto the history without a navigation (the page underneath
// stays put), switching sections replaces it, and closing goes back. A hard
// load of the address is a real route that renders the new-chat screen, with
// settings over it.

export const settingsSectionSchema = z.enum([
  "profile",
  "keys",
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

export const settingsRouteFromPath = (pathname: string): SettingsRoute => {
  const match = SETTINGS_PATH.exec(pathname);
  if (!match) {
    return null;
  }
  if (match[1] === undefined) {
    return "index";
  }
  const section = settingsSectionSchema.safeParse(match[1]);
  return section.success ? section.data : null;
};

export const settingsPath = (section?: SettingsSection): string =>
  section ? `/settings/${section}` : "/settings";

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
  section?: SettingsSection
): void => {
  if (settingsRouteFromPath(pathname) !== null) {
    selectSettingsSection(history, section);
    return;
  }
  history.pushState({ [OVERLAY_KEY]: true }, "", settingsPath(section));
};

/** Another section, same history entry: Back still closes the view. */
export const selectSettingsSection = (
  history: SettingsHistory,
  section?: SettingsSection
): void => {
  // Only our mark: passing the router's own state back makes Next treat the
  // call as its own and skip syncing `usePathname`.
  history.replaceState(
    pushedBySettings(history.state) ? { [OVERLAY_KEY]: true } : null,
    "",
    settingsPath(section)
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
