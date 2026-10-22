import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { useCallback, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import {
  PANEL_MIN_WIDTH,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_WIDTH_STORAGE_KEY,
  SIDEBAR_WIDTH_VAR,
} from "../model/layout";
import { renderWithI18n } from "../testing/render";
import { AppShell, type AppShellProps } from "./app-shell";
import { SidebarToggle } from "./sidebar-toggle";
import { useShellLayout } from "./use-shell-layout";

// The shell's resize handles and where the sidebar shows when it can't dock.
// The test frame is 1336px wide (vitest.config.ts), so nothing has to yield.

const renderShell = (overrides: Partial<AppShellProps> = {}) => {
  const props: AppShellProps = {
    children: <p>Conversation</p>,
    claimSidebarToggle: vi.fn(),
    header: <header>Header</header>,
    onPanelClose: vi.fn(),
    onPanelWidthChange: vi.fn(),
    onSidebarSheetOpenChange: vi.fn(),
    panel: <p>Panel</p>,
    panelOpen: false,
    panelWidth: 560,
    sidebar: (
      <nav aria-label="Sidebar contents">
        <button type="button">Row</button>
      </nav>
    ),
    sidebarOpen: true,
    sidebarSheetOpen: false,
    ...overrides,
  };
  renderWithI18n(<AppShell {...props} />);
  return props;
};

const sidebarHandle = () =>
  screen.getByRole("separator", { name: "Resize sidebar" });
const sidebarWidth = () =>
  screen.getByRole("complementary", { name: "Chats" }).getBoundingClientRect()
    .width;

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.style.removeProperty(SIDEBAR_WIDTH_VAR);
});
afterEach(cleanup);

describe("the sidebar's resize handle", () => {
  it("is a labelled separator reporting the width in pixels", async () => {
    renderShell();
    const handle = sidebarHandle();
    await waitFor(() =>
      expect(handle.getAttribute("aria-valuenow")).toBe(
        String(SIDEBAR_DEFAULT_WIDTH)
      )
    );
    expect(handle.getAttribute("aria-valuemin")).toBe(
      String(SIDEBAR_MIN_WIDTH)
    );
    expect(handle.getAttribute("aria-valuemax")).toBe(
      String(SIDEBAR_MAX_WIDTH)
    );
    expect(handle.getAttribute("aria-orientation")).toBe("vertical");
    expect(sidebarWidth()).toBe(SIDEBAR_DEFAULT_WIDTH);
  });

  it("nudges 16px with the arrows, jumps with Home/End and saves each", async () => {
    renderShell();
    const handle = sidebarHandle();
    handle.focus();
    await userEvent.keyboard("{ArrowRight}{ArrowRight}");
    expect(handle.getAttribute("aria-valuenow")).toBe("292");
    expect(sidebarWidth()).toBe(292);
    expect(window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)).toBe("292");
    expect(
      document.documentElement.style.getPropertyValue(SIDEBAR_WIDTH_VAR)
    ).toBe("292px");
    await userEvent.keyboard("{ArrowLeft}");
    expect(handle.getAttribute("aria-valuenow")).toBe("276");
    await userEvent.keyboard("{End}");
    expect(handle.getAttribute("aria-valuenow")).toBe(
      String(SIDEBAR_MAX_WIDTH)
    );
    await userEvent.keyboard("{Home}");
    expect(handle.getAttribute("aria-valuenow")).toBe(
      String(SIDEBAR_MIN_WIDTH)
    );
  });

  it("follows a drag, saves once on release, and resets on double-click", () => {
    renderShell();
    const handle = sidebarHandle();
    const box = handle.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + 100;
    fireEvent.pointerDown(handle, {
      button: 0,
      clientX: x,
      clientY: y,
      pointerId: 1,
    });
    fireEvent.pointerMove(handle, {
      clientX: x + 60,
      clientY: y,
      pointerId: 1,
    });
    expect(sidebarWidth()).toBe(SIDEBAR_DEFAULT_WIDTH + 60);
    // Nothing is saved mid-drag, and nothing on the page selects.
    expect(window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)).toBeNull();
    expect(document.documentElement.style.userSelect).toBe("none");
    // Past the maximum it stops there.
    fireEvent.pointerMove(handle, {
      clientX: x + 900,
      clientY: y,
      pointerId: 1,
    });
    expect(sidebarWidth()).toBe(SIDEBAR_MAX_WIDTH);
    fireEvent.pointerUp(handle, { clientX: x + 900, clientY: y, pointerId: 1 });
    expect(window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)).toBe(
      String(SIDEBAR_MAX_WIDTH)
    );
    expect(document.documentElement.style.userSelect).toBe("");

    fireEvent.doubleClick(handle);
    expect(sidebarWidth()).toBe(SIDEBAR_DEFAULT_WIDTH);
    expect(window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)).toBe(
      String(SIDEBAR_DEFAULT_WIDTH)
    );
  });

  it("starts at the saved width", async () => {
    window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, "333");
    renderShell();
    await waitFor(() => expect(sidebarWidth()).toBe(333));
  });
});

describe("the side panel's resize handle", () => {
  it("is labelled, keeps 480px for the conversation and reports a finished resize", async () => {
    const props = renderShell({ panelOpen: true, panelWidth: 400 });
    const handle = screen.getByRole("separator", { name: "Resize side panel" });
    expect(handle.getAttribute("aria-valuenow")).toBe("400");
    handle.focus();
    // The panel is after the handle: → makes it narrower.
    await userEvent.keyboard("{ArrowRight}");
    expect(props.onPanelWidthChange).toHaveBeenLastCalledWith(384);
    await userEvent.keyboard("{Home}");
    expect(props.onPanelWidthChange).toHaveBeenLastCalledWith(PANEL_MIN_WIDTH);
    // What's left after 480px for the conversation and the sidebar.
    const room = document.documentElement.clientWidth - 480;
    expect(handle.getAttribute("aria-valuemax")).toBe(
      String(room - SIDEBAR_DEFAULT_WIDTH)
    );
    await userEvent.keyboard("{End}");
    expect(props.onPanelWidthChange).toHaveBeenLastCalledWith(
      room - SIDEBAR_DEFAULT_WIDTH
    );
  });
});

// The shell as the app wires it: the shared layout, the sheet state the
// caller owns, a toggle in the header, and the toggle's shortcut.
function WiredShell({ panelOpen = false }: { readonly panelOpen?: boolean }) {
  const { claimSidebarToggle, layout, toggleSidebar } =
    useShellLayout("test:layout");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [panel, setPanel] = useState(panelOpen);
  const togglePanel = useCallback(() => setPanel((open) => !open), []);
  const closePanel = useCallback(() => setPanel(false), []);
  const pickChat = useCallback(() => setSheetOpen(false), []);
  return (
    <AppShell
      claimSidebarToggle={claimSidebarToggle}
      header={
        <header>
          <SidebarToggle onToggle={toggleSidebar} placement="rail" />
        </header>
      }
      onPanelClose={closePanel}
      onSidebarSheetOpenChange={setSheetOpen}
      panel={<p>Panel</p>}
      panelOpen={panel}
      panelWidth={400}
      sidebar={
        <nav aria-label="Sidebar contents">
          <button onClick={pickChat} type="button">
            Pick a chat
          </button>
        </nav>
      }
      sidebarOpen={layout.sidebarOpen}
      sidebarSheetOpen={sheetOpen}
    >
      <p>Conversation</p>
      <button onClick={toggleSidebar} type="button">
        Shortcut
      </button>
      <button onClick={togglePanel} type="button">
        Files
      </button>
    </AppShell>
  );
}

const chats = () => screen.queryByRole("complementary", { name: "Chats" });
const toggle = () => screen.getByRole("button", { name: "Toggle sidebar" });

describe("a collapsed sidebar", () => {
  it("doesn't show on hover", async () => {
    renderShell({ sidebarOpen: false });
    const atStartEdge = document.elementFromPoint(4, 400);
    expect(atStartEdge).not.toBeNull();
    await userEvent.hover(atStartEdge as Element);
    expect(chats()).toBeNull();
  });

  it("docks from the toggle when there's room", async () => {
    renderWithI18n(<WiredShell />);
    await userEvent.click(toggle());
    expect(chats()).toBeNull();
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(toggle());
    expect(chats()).not.toBeNull();
    expect(
      screen.getByRole("separator", { name: "Resize sidebar" })
    ).toBeTruthy();
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
  });
});

describe("a sidebar with no room to dock", () => {
  // 900px: the conversation's 480 and the panel's 280 leave the sidebar 140.
  beforeEach(async () => {
    await page.viewport(900, 800);
  });
  afterEach(async () => {
    await page.viewport(1336, 800);
  });

  it("doesn't come up on its own when the panel squeezes it out", async () => {
    renderWithI18n(<WiredShell />);
    expect(chats()).not.toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Files" }));
    expect(chats()).toBeNull();
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
  });

  it("shows over the page from the toggle, and Esc closes it", async () => {
    renderWithI18n(<WiredShell panelOpen />);
    const conversation = screen.getByText("Conversation");
    const before = conversation.getBoundingClientRect().left;
    await userEvent.click(toggle());
    expect(chats()).not.toBeNull();
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    expect(conversation.getBoundingClientRect().left).toBe(before);
    expect(chats()?.contains(document.activeElement)).toBe(true);
    expect(
      screen.queryByRole("separator", { name: "Resize sidebar" })
    ).toBeNull();

    await userEvent.keyboard("{Escape}");
    expect(chats()).toBeNull();
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
  });

  it("closes from the toggle, the shortcut, or picking a chat", async () => {
    renderWithI18n(<WiredShell panelOpen />);
    const shortcut = screen.getByRole("button", { name: "Shortcut" });
    await userEvent.click(shortcut);
    expect(chats()).not.toBeNull();
    await userEvent.click(toggle());
    expect(chats()).toBeNull();
    await userEvent.click(toggle());
    await userEvent.click(shortcut);
    expect(chats()).toBeNull();
    await userEvent.click(shortcut);
    await userEvent.click(screen.getByRole("button", { name: "Pick a chat" }));
    expect(chats()).toBeNull();
  });

  it("closes when it can dock again, and stays closed when squeezed again", async () => {
    renderWithI18n(<WiredShell panelOpen />);
    await userEvent.click(toggle());
    expect(
      screen.queryByRole("separator", { name: "Resize sidebar" })
    ).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Files" }));
    expect(
      screen.getByRole("separator", { name: "Resize sidebar" })
    ).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Files" }));
    expect(chats()).toBeNull();
  });
});

describe("the icon rail (181)", () => {
  const rail = <nav aria-label="Rail">Rail</nav>;

  it("sits beside the open sidebar", () => {
    renderShell({ rail });
    expect(screen.getByRole("navigation", { name: "Rail" })).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "Chats" })).toBeTruthy();
  });

  it("stays when the sidebar collapses", () => {
    renderShell({ rail, sidebarOpen: false });
    expect(screen.getByRole("navigation", { name: "Rail" })).toBeTruthy();
    expect(
      screen.queryByRole("separator", { name: "Resize sidebar" })
    ).toBeNull();
  });
});
