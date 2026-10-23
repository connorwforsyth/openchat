import { z } from "zod";

// The app shell's remembered layout (ticket 009: "resizable, remembers
// state"): the sidebar, whether the Workspace panel is open, which of its
// sections it shows, and how wide it is. Stored per browser; anything
// unreadable falls back to the defaults.

/**
 * The Workspace panel's sections: the chat's files, its browser (the
 * Preview, 137: the header's Browser) or its artifacts. Files and artifacts
 * share the lower half; the browser is the upper one. Non-null in the
 * layout means the panel is open.
 */
export const workspaceSectionSchema = z.enum(["files", "browser", "artifacts"]);
export type WorkspaceSection = z.infer<typeof workspaceSectionSchema>;

/**
 * Before 060 the panel had Sandbox and Artifacts tabs; a stored `"sandbox"`
 * reopens on the files, and `"artifacts"` keeps meaning the artifacts.
 */
const storedPanelSchema = z.preprocess(
  (value) => (value === "sandbox" ? "files" : value),
  workspaceSectionSchema.nullable()
);

export const PANEL_MIN_WIDTH = 280;
export const PANEL_MAX_WIDTH = 960;
// Wide enough for the file list beside an editor.
export const PANEL_DEFAULT_WIDTH = 560;

export const shellLayoutSchema = z.object({
  panel: storedPanelSchema.catch(null),
  panelWidth: z
    .number()
    .transform(Math.round)
    .pipe(z.int().min(PANEL_MIN_WIDTH).max(PANEL_MAX_WIDTH))
    .catch(PANEL_DEFAULT_WIDTH),
  sidebarOpen: z.boolean().catch(true),
});
export type ShellLayout = z.infer<typeof shellLayoutSchema>;

export const defaultShellLayout: ShellLayout = {
  panel: null,
  panelWidth: PANEL_DEFAULT_WIDTH,
  sidebarOpen: true,
};

/** Reads a stored layout; bad JSON or fields fall back field by field. */
export const parseShellLayout = (raw: string | null): ShellLayout => {
  if (raw === null) {
    return defaultShellLayout;
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return defaultShellLayout;
  }
  const parsed = shellLayoutSchema.safeParse({
    ...defaultShellLayout,
    ...(typeof json === "object" && json !== null ? json : {}),
  });
  return parsed.success ? parsed.data : defaultShellLayout;
};

/** Keeps a dragged width inside the panel's bounds. */
export const clampPanelWidth = (width: number): number =>
  Number.isFinite(width)
    ? Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, Math.round(width)))
    : PANEL_DEFAULT_WIDTH;

/**
 * Opens the Workspace panel on `panel`, or closes it if that section is the
 * one showing (the S / A keys).
 */
export const togglePanel = (
  layout: ShellLayout,
  panel: WorkspaceSection
): ShellLayout => ({
  ...layout,
  panel: layout.panel === panel ? null : panel,
});

// The sidebar's width (071). Kept apart from `ShellLayout`: the shell itself
// owns and saves it (the pages that render the shell don't need it), and the
// app's pre-paint script reads it so a reload paints the saved width at once.

export const SIDEBAR_MIN_WIDTH = 200;
export const SIDEBAR_MAX_WIDTH = 420;
export const SIDEBAR_DEFAULT_WIDTH = 260;

/** The conversation column never gets narrower than this; the sides yield. */
export const CENTRE_MIN_WIDTH = 480;

/** How far one ←/→ press moves a resize handle. */
export const RESIZE_KEY_STEP = 16;

/** Where the sidebar's width is kept (`localStorage`). */
export const SIDEBAR_WIDTH_STORAGE_KEY = "chat-ui:sidebar-width";

/**
 * The CSS variable on `<html>` holding the saved width, so the first paint
 * (and a shell that remounts on another page) starts at it.
 */
export const SIDEBAR_WIDTH_VAR = "--app-sidebar-width";

const clampTo = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** Keeps a width inside the sidebar's own bounds. */
export const clampSidebarWidth = (width: number): number =>
  Number.isFinite(width)
    ? clampTo(Math.round(width), SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH)
    : SIDEBAR_DEFAULT_WIDTH;

/** Reads a stored width; anything unreadable is the default. */
export const parseSidebarWidth = (raw: string | null): number => {
  const width = raw === null || raw.trim() === "" ? Number.NaN : Number(raw);
  return clampSidebarWidth(width);
};

/** What the shell can give each column at a viewport width. */
export interface ShellColumns {
  /** The panel's width, when it's open. */
  readonly panel: number;
  readonly panelMax: number;
  /** The docked sidebar's width, or `null` when it's collapsed or can't dock. */
  readonly sidebar: number | null;
  /**
   * There's room to dock the sidebar, open or not. Without it, the toggle
   * shows the sidebar over the page instead.
   */
  readonly sidebarFits: boolean;
  /** The widest the sidebar may be dragged right now. */
  readonly sidebarMax: number;
}

/**
 * Fits the sidebar and the panel around a conversation of at least
 * `CENTRE_MIN_WIDTH`. The sidebar yields first: it shrinks toward its
 * minimum, and when even that leaves the open panel less than its own
 * minimum it stops docking (the user's choice is kept for when there's
 * room; until then the toggle shows it over the page).
 * Then the panel shrinks. `viewport` is `null` before the first measure,
 * when the stored widths are used as they are.
 */
export const fitShellColumns = ({
  panelOpen,
  panelWidth,
  sidebarOpen,
  sidebarWidth,
  viewport,
}: {
  readonly panelOpen: boolean;
  readonly panelWidth: number;
  readonly sidebarOpen: boolean;
  readonly sidebarWidth: number;
  readonly viewport: number | null;
}): ShellColumns => {
  if (viewport === null) {
    return {
      panel: panelWidth,
      panelMax: PANEL_MAX_WIDTH,
      sidebar: sidebarOpen ? sidebarWidth : null,
      sidebarFits: true,
      sidebarMax: SIDEBAR_MAX_WIDTH,
    };
  }
  const panelReserve = panelOpen ? PANEL_MIN_WIDTH : 0;
  const room = viewport - CENTRE_MIN_WIDTH - panelReserve;
  const sidebarMax = clampTo(room, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH);
  const sidebarFits = room >= SIDEBAR_MIN_WIDTH;
  const sidebar =
    sidebarOpen && sidebarFits
      ? clampTo(sidebarWidth, SIDEBAR_MIN_WIDTH, sidebarMax)
      : null;
  const panelMax = clampTo(
    viewport - CENTRE_MIN_WIDTH - (sidebar ?? 0),
    PANEL_MIN_WIDTH,
    PANEL_MAX_WIDTH
  );
  return {
    panel: clampTo(panelWidth, PANEL_MIN_WIDTH, panelMax),
    panelMax,
    sidebar,
    sidebarFits,
    sidebarMax,
  };
};
