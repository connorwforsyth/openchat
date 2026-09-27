import { cleanup, screen, waitFor } from "@testing-library/react";
import {
  conversation,
  fixtureId,
  org,
  userAda,
} from "@workspace/contract/fixtures";
import type { Me, PublicConfig } from "@workspace/contract/schemas/meta";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import {
  AppFrameProvider,
  type AppFrameValue,
} from "@/app/(app)/_shared/app-frame";
import { fakeApi, renderWithApi } from "@/app/(app)/_shared/test-harness";

import { PageShell } from "./page-shell";

const NEW_CHAT = /New chat/;
const SEARCH = /Search/;

const push = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => "/library",
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

const me: Me = {
  orgs: [org],
  persistClientCache: true,
  personalOrgId: fixtureId("org", 9),
  teams: [],
  user: {
    email: "ada@example.test",
    id: userAda.id,
    image: null,
    isAdmin: false,
    locale: null,
    name: userAda.name,
  },
};

const config: PublicConfig = {
  auth: { providers: [], signup: "invite" },
  brand: { faviconUrl: null, logoUrl: null, name: "Test Chat" },
  features: {
    fileUploads: true,
    importers: false,
    memory: true,
    publicLinks: false,
    sandboxes: false,
    webSearch: false,
  },
  limits: { memoryMaxChars: 4000, uploadMaxMb: 20 },
  policies: { chatContexts: ["personal", "team", "org"] },
  sandbox: { default: null, providers: [] },
};

const frame = (overrides: Partial<AppFrameValue> = {}): AppFrameValue => ({
  chat: {
    draftContext: { type: "personal" },
    paletteContext: undefined,
    setDraftContext: vi.fn(),
    setPaletteContext: vi.fn(),
    setTarget: vi.fn(),
    target: null,
  },
  config,
  layout: {
    layout: { panel: null, panelWidth: 400, sidebarOpen: true },
    setPanel: vi.fn(),
    setPanelWidth: vi.fn(),
    togglePanel: vi.fn(),
    toggleSidebar: vi.fn(),
  },
  me,
  openPalette: vi.fn(),
  paletteOpen: false,
  setPaletteOpen: vi.fn(),
  setTheme: vi.fn(),
  signOut: vi.fn(),
  theme: "system",
  ...overrides,
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

  it("toggles the shared sidebar, from the header and with ⌘B", async () => {
    const value = frame();
    renderWithApi(
      <AppFrameProvider value={value}>
        <PageShell>
          <p>Page</p>
        </PageShell>
      </AppFrameProvider>,
      api()
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Toggle sidebar" })
    );
    expect(value.layout.toggleSidebar).toHaveBeenCalledTimes(1);
    await userEvent.keyboard("{Meta>}b{/Meta}");
    await waitFor(() =>
      expect(value.layout.toggleSidebar).toHaveBeenCalledTimes(2)
    );
  });

  it("leaves the sidebar out while it's collapsed", () => {
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
    // The header offers a new chat instead.
    expect(screen.getByRole("button", { name: "New chat" })).toBeTruthy();
  });
});
