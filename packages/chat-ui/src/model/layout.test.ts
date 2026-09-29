import { describe, expect, it } from "vitest";

import {
  clampPanelWidth,
  defaultShellLayout,
  PANEL_MAX_WIDTH,
  PANEL_MIN_WIDTH,
  parseShellLayout,
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
