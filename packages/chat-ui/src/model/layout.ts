import { z } from "zod";

// The app shell's remembered layout (ticket 009: "resizable, remembers
// state"): the sidebar, which right panel is open and how wide it is. Stored
// per browser; anything unreadable falls back to the defaults.

export const rightPanelSchema = z.enum(["sandbox", "artifacts"]);
export type RightPanel = z.infer<typeof rightPanelSchema>;

export const PANEL_MIN_WIDTH = 280;
export const PANEL_MAX_WIDTH = 960;
export const PANEL_DEFAULT_WIDTH = 400;

export const shellLayoutSchema = z.object({
  panel: rightPanelSchema.nullable().catch(null),
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

/** Opens `panel`, or closes it if it's the one showing (the S / A keys). */
export const togglePanel = (
  layout: ShellLayout,
  panel: RightPanel
): ShellLayout => ({
  ...layout,
  panel: layout.panel === panel ? null : panel,
});
