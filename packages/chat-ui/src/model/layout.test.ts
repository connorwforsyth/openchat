import { describe, expect, it } from "vitest";

import {
  CENTRE_MIN_WIDTH,
  clampPanelWidth,
  clampSidebarWidth,
  defaultShellLayout,
  fitShellColumns,
  PANEL_MAX_WIDTH,
  PANEL_MIN_WIDTH,
  parseShellLayout,
  parseSidebarWidth,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  togglePanel,
} from "./layout";

describe("parseShellLayout", () => {
  it("reads a stored layout", () => {
    expect(
      parseShellLayout(
        JSON.stringify({
          panel: "artifacts",
          panelWidth: 500,
          sidebarOpen: false,
        })
      )
    ).toEqual({ panel: "artifacts", panelWidth: 500, sidebarOpen: false });
  });

  it("falls back field by field, and wholesale on bad JSON", () => {
    expect(parseShellLayout(null)).toEqual(defaultShellLayout);
    expect(parseShellLayout("{nope")).toEqual(defaultShellLayout);
    expect(
      parseShellLayout(
        JSON.stringify({ panel: "chat", panelWidth: 5, sidebarOpen: false })
      )
    ).toEqual({ ...defaultShellLayout, sidebarOpen: false });
  });
});

describe("the Workspace panel's layout (060)", () => {
  // Before 060 the panel had Sandbox and Artifacts tabs.
  it("migrates a stored Artifacts tab to the panel on its artifacts", () => {
    expect(
      parseShellLayout(JSON.stringify({ panel: "artifacts", panelWidth: 480 }))
    ).toMatchObject({ panel: "artifacts", panelWidth: 480 });
  });

  it("migrates a stored Sandbox tab to the panel on its files", () => {
    expect(parseShellLayout(JSON.stringify({ panel: "sandbox" }))).toEqual({
      ...defaultShellLayout,
      panel: "files",
    });
  });

  it("keeps a closed panel closed", () => {
    expect(parseShellLayout(JSON.stringify({ panel: null })).panel).toBeNull();
  });
});

describe("togglePanel and clampPanelWidth", () => {
  it("opens a section, switches between them and closes the open one", () => {
    const files = togglePanel(defaultShellLayout, "files");
    expect(files.panel).toBe("files");
    expect(togglePanel(files, "artifacts").panel).toBe("artifacts");
    expect(togglePanel(files, "files").panel).toBeNull();
  });

  it("keeps widths in bounds", () => {
    expect(clampPanelWidth(10)).toBe(PANEL_MIN_WIDTH);
    expect(clampPanelWidth(10_000)).toBe(PANEL_MAX_WIDTH);
    expect(clampPanelWidth(412.6)).toBe(413);
  });
});

describe("the sidebar's width (071)", () => {
  it("keeps a width inside 200–420, rounded", () => {
    expect(clampSidebarWidth(10)).toBe(SIDEBAR_MIN_WIDTH);
    expect(clampSidebarWidth(9000)).toBe(SIDEBAR_MAX_WIDTH);
    expect(clampSidebarWidth(301.6)).toBe(302);
    expect(clampSidebarWidth(Number.NaN)).toBe(SIDEBAR_DEFAULT_WIDTH);
  });

  it("reads what was saved, and the default for anything else", () => {
    expect(parseSidebarWidth("312")).toBe(312);
    expect(parseSidebarWidth("999")).toBe(SIDEBAR_MAX_WIDTH);
    expect(parseSidebarWidth(null)).toBe(SIDEBAR_DEFAULT_WIDTH);
    expect(parseSidebarWidth("")).toBe(SIDEBAR_DEFAULT_WIDTH);
    expect(parseSidebarWidth("wide")).toBe(SIDEBAR_DEFAULT_WIDTH);
  });
});

describe("fitShellColumns: the conversation keeps 480px (071)", () => {
  const columnsAt = (
    viewport: number | null,
    {
      panelOpen = false,
      panelWidth = 560,
      sidebarOpen = true,
      sidebarWidth = SIDEBAR_DEFAULT_WIDTH,
    } = {}
  ) =>
    fitShellColumns({
      panelOpen,
      panelWidth,
      sidebarOpen,
      sidebarWidth,
      viewport,
    });

  it("uses the saved widths as they are before the first measure", () => {
    expect(columnsAt(null, { panelOpen: true, sidebarWidth: 400 })).toEqual({
      panel: 560,
      panelMax: PANEL_MAX_WIDTH,
      sidebar: 400,
      sidebarMax: SIDEBAR_MAX_WIDTH,
    });
  });

  it("gives a wide window everything it asks for", () => {
    const columns = columnsAt(1440, { panelOpen: true, sidebarWidth: 300 });
    expect(columns.sidebar).toBe(300);
    expect(columns.panel).toBe(560);
    expect(columns.panelMax).toBe(1440 - CENTRE_MIN_WIDTH - 300);
  });

  it("shrinks the sidebar first when the window can't fit it", () => {
    // 800 - 480 leaves 320 for the sidebar.
    const columns = columnsAt(800, { sidebarWidth: 400 });
    expect(columns.sidebar).toBe(320);
    expect(columns.sidebarMax).toBe(320);
  });

  it("stops docking the sidebar when the open panel would go below its minimum", () => {
    // 900: 480 + 280 leaves 140, less than the sidebar's 200.
    const columns = columnsAt(900, { panelOpen: true });
    expect(columns.sidebar).toBeNull();
    expect(columns.panelMax).toBe(900 - CENTRE_MIN_WIDTH);
    expect(columns.panel).toBe(900 - CENTRE_MIN_WIDTH);
  });

  it("keeps both docked at 1024px, the panel at its minimum", () => {
    const columns = columnsAt(1024, { panelOpen: true });
    expect(columns.sidebar).toBe(SIDEBAR_DEFAULT_WIDTH);
    expect(columns.panel).toBe(1024 - CENTRE_MIN_WIDTH - SIDEBAR_DEFAULT_WIDTH);
    expect(columns.panel).toBeGreaterThanOrEqual(PANEL_MIN_WIDTH);
  });

  it("never docks a sidebar the user collapsed", () => {
    expect(columnsAt(1440, { sidebarOpen: false }).sidebar).toBeNull();
  });
});
