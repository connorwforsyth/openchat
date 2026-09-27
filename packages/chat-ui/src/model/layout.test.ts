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

describe("togglePanel and clampPanelWidth", () => {
  it("opens a panel, switches between them and closes the open one", () => {
    const sandbox = togglePanel(defaultShellLayout, "sandbox");
    expect(sandbox.panel).toBe("sandbox");
    expect(togglePanel(sandbox, "artifacts").panel).toBe("artifacts");
    expect(togglePanel(sandbox, "sandbox").panel).toBeNull();
  });

  it("keeps widths in bounds", () => {
    expect(clampPanelWidth(10)).toBe(PANEL_MIN_WIDTH);
    expect(clampPanelWidth(10_000)).toBe(PANEL_MAX_WIDTH);
    expect(clampPanelWidth(412.6)).toBe(413);
  });
});
