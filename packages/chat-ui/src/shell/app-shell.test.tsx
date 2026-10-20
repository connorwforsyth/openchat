import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import {
  PANEL_MIN_WIDTH,
  PEEK_CLOSE_DELAY_MS,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_WIDTH_STORAGE_KEY,
  SIDEBAR_WIDTH_VAR,
} from "../model/layout";
import { renderWithI18n } from "../testing/render";
import { AppShell, type AppShellProps } from "./app-shell";

// The shell's resize handles and the collapsed sidebar's peek (071). The
// test frame is 1336px wide (vitest.config.ts), so nothing has to yield.

const renderShell = (overrides: Partial<AppShellProps> = {}) => {
  const props: AppShellProps = {
    children: <p>Conversation</p>,
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

describe("the collapsed sidebar's peek", () => {
  const peek = () =>
    document.querySelector<HTMLElement>('[data-slot="app-shell-sidebar-peek"]');
  const edge = () =>
    document.querySelector<HTMLElement>('[data-slot="app-shell-sidebar-edge"]');

  it("shows on the edge over the page and goes 500ms after the pointer leaves", () => {
    renderShell({ sidebarOpen: false });
    expect(screen.queryByRole("complementary", { name: "Chats" })).toBeNull();
    const conversation = screen.getByText("Conversation");
    const before = conversation.getBoundingClientRect().left;

    vi.useFakeTimers();
    try {
      act(() => {
        fireEvent.pointerEnter(edge() as HTMLElement);
      });
      expect(peek()?.hasAttribute("data-open")).toBe(true);
      expect(screen.getByRole("complementary", { name: "Chats" })).toBeTruthy();
      // An overlay: the conversation didn't move.
      expect(conversation.getBoundingClientRect().left).toBe(before);

      act(() => {
        fireEvent.pointerEnter(peek() as HTMLElement);
        fireEvent.pointerLeave(peek() as HTMLElement);
      });
      act(() => vi.advanceTimersByTime(PEEK_CLOSE_DELAY_MS - 1));
      expect(peek()?.hasAttribute("data-open")).toBe(true);
      act(() => vi.advanceTimersByTime(1));
      expect(peek()?.hasAttribute("data-open")).toBe(false);
      expect(peek()?.inert).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stays while a menu opened from it is open", () => {
    renderShell({
      sidebar: (
        <button aria-expanded="true" type="button">
          Menu
        </button>
      ),
      sidebarOpen: false,
    });
    vi.useFakeTimers();
    try {
      act(() => {
        fireEvent.pointerEnter(edge() as HTMLElement);
        fireEvent.pointerLeave(peek() as HTMLElement);
      });
      act(() => vi.advanceTimersByTime(PEEK_CLOSE_DELAY_MS * 3));
      expect(peek()?.hasAttribute("data-open")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
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
    // Only the (closed) peek remains of the sidebar.
    expect(
      screen.queryByRole("separator", { name: "Resize sidebar" })
    ).toBeNull();
  });
});
