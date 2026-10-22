import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { SidebarLayoutProvider } from "@workspace/chat-ui/shell/sidebar-layout";
import { conversation } from "@workspace/contract/fixtures";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { AppFrameProvider } from "@/app/(app)/_shared/app-frame";
import {
  testFrame as frame,
  testMe as me,
} from "@/app/(app)/_shared/frame-fixture";
import { fakeApi, renderWithApi } from "@/app/(app)/_shared/test-harness";

import { PageShell } from "./page-shell";

const NEW_CHAT = /New chat/;
const SEARCH = /Search/;

const push = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => "/settings/profile",
  useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn() }),
}));

// Wide enough for the sidebar to sit beside the page, not in a sheet.
beforeAll(async () => {
  await page.viewport(1280, 800);
});

afterEach(() => {
  cleanup();
  push.mockReset();
});

const api = () =>
  fakeApi({
    "GET /conversations": () => ({ items: [conversation], nextCursor: null }),
  });

describe("PageShell", () => {
  it("wraps a page in the app shell with the chats from the API", async () => {
    renderWithApi(
      <AppFrameProvider value={frame()}>
        <PageShell>
          <p>Library page</p>
        </PageShell>
      </AppFrameProvider>,
      api()
    );
    expect(screen.getByText("Library page")).toBeTruthy();
    expect(screen.getByText("Test Chat")).toBeTruthy();
    const chat = await screen.findByText(conversation.title ?? "");
    await userEvent.click(chat);
    expect(push).toHaveBeenCalledWith(`/c/${conversation.id}`);
  });

  it("starts a new chat and opens the palette from the sidebar", async () => {
    const value = frame();
    renderWithApi(
      <AppFrameProvider value={value}>
        <PageShell>
          <p>Page</p>
        </PageShell>
      </AppFrameProvider>,
      api()
    );
    await userEvent.click(screen.getByRole("button", { name: NEW_CHAT }));
    expect(push).toHaveBeenCalledWith("/");
    await userEvent.click(screen.getByRole("button", { name: SEARCH }));
    expect(value.openPalette).toHaveBeenCalled();
  });

  it("toggles the shared sidebar, from the sidebar's top row and with ⌘B", async () => {
    const value = frame();
    renderWithApi(
      <AppFrameProvider value={value}>
        <PageShell>
          <p>Page</p>
        </PageShell>
      </AppFrameProvider>,
      api()
    );
    // The toggle is the rail's first button on a wide screen (181).
    const rail = within(
      screen.getByRole("navigation", { name: "Sidebar rail" })
    );
    await userEvent.click(rail.getByRole("button", { name: "Toggle sidebar" }));
    expect(value.layout.toggleSidebar).toHaveBeenCalledTimes(1);
    await userEvent.keyboard("{Meta>}b{/Meta}");
    await waitFor(() =>
      expect(value.layout.toggleSidebar).toHaveBeenCalledTimes(2)
    );
  });

  it("offers a new organisation from the account menu (044)", async () => {
    const value = frame();
    renderWithApi(
      <AppFrameProvider value={value}>
        <PageShell>
          <p>Page</p>
        </PageShell>
      </AppFrameProvider>,
      api()
    );
    // On a wide screen the account menu is at the foot of the rail (181).
    const rail = screen.getByRole("navigation", { name: "Sidebar rail" });
    await userEvent.click(
      within(rail).getByRole("button", { name: `Account: ${me.user.name}` })
    );
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "New organisation" })
    );
    expect(value.openNewOrg).toHaveBeenCalled();
  });

  it("keeps the rail while the sidebar is collapsed (181)", () => {
    renderWithApi(
      <AppFrameProvider
        value={frame({
          layout: {
            ...frame().layout,
            layout: { panel: null, panelWidth: 400, sidebarOpen: false },
          },
        })}
      >
        <PageShell>
          <p>Page</p>
        </PageShell>
      </AppFrameProvider>,
      api()
    );
    expect(screen.queryByRole("complementary", { name: "Chats" })).toBeNull();
    // The rail stays (181) and keeps the only sidebar toggle; the header
    // has none.
    const rail = screen.getByRole("navigation", { name: "Sidebar rail" });
    expect(
      within(rail).getByRole("button", { name: "Toggle sidebar" })
    ).toBeTruthy();
    expect(
      screen.getAllByRole("button", { name: "Toggle sidebar" })
    ).toHaveLength(1);
    expect(within(rail).getByRole("button", { name: "Chats" })).toBeTruthy();
  });

  describe("classic layout (181)", () => {
    const renderClassic = (sidebarOpen: boolean) => {
      const value = frame({
        layout: {
          ...frame().layout,
          layout: { panel: null, panelWidth: 400, sidebarOpen },
        },
        sidebarLayout: "classic",
      });
      renderWithApi(
        <AppFrameProvider value={value}>
          <SidebarLayoutProvider value="classic">
            <PageShell>
              <p>Page</p>
            </PageShell>
          </SidebarLayoutProvider>
        </AppFrameProvider>,
        api()
      );
      return value;
    };

    it("has no rail, and every page in the sidebar's nav", () => {
      renderClassic(true);
      expect(
        screen.queryByRole("navigation", { name: "Sidebar rail" })
      ).toBeNull();
      const nav = within(screen.getByRole("navigation", { name: "Primary" }));
      expect(nav.getByRole("button", { name: NEW_CHAT })).toBeTruthy();
      expect(nav.getByRole("button", { name: SEARCH })).toBeTruthy();
      expect(nav.getByRole("link", { name: "Library" })).toBeTruthy();
      expect(nav.getByRole("link", { name: "Artifacts" })).toBeTruthy();
      expect(nav.getByRole("link", { name: "Scheduled" })).toBeTruthy();
      // The account menu is at the sidebar's foot.
      const sidebar = within(
        screen.getByRole("complementary", { name: "Chats" })
      );
      expect(
        sidebar.getByRole("button", { name: `Account: ${me.user.name}` })
      ).toBeTruthy();
    });

    it("puts the toggle in the sidebar's top row while it's open", async () => {
      const value = renderClassic(true);
      const sidebar = within(
        screen.getByRole("complementary", { name: "Chats" })
      );
      const toggles = screen.getAllByRole("button", { name: "Toggle sidebar" });
      expect(toggles).toHaveLength(1);
      await userEvent.click(
        sidebar.getByRole("button", { name: "Toggle sidebar" })
      );
      expect(value.layout.toggleSidebar).toHaveBeenCalledTimes(1);
    });

    it("hides the sidebar when collapsed, with the toggle in the header", () => {
      renderClassic(false);
      expect(
        screen.queryByRole("navigation", { name: "Sidebar rail" })
      ).toBeNull();
      expect(screen.queryByRole("complementary", { name: "Chats" })).toBeNull();
      const toggle = screen.getByRole("button", { name: "Toggle sidebar" });
      expect(toggle.closest("header")).not.toBeNull();
    });
  });
});
