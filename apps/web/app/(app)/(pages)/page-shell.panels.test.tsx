import { cleanup, screen, within } from "@testing-library/react";
import { SidebarLayoutProvider } from "@workspace/chat-ui/shell/sidebar-layout";
import { conversation, fixtureId } from "@workspace/contract/fixtures";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { AppFrameProvider } from "@/app/(app)/_shared/app-frame";
import { testFrame as frame } from "@/app/(app)/_shared/frame-fixture";
import { fakeApi, renderWithApi } from "@/app/(app)/_shared/test-harness";

import { PageShell } from "./page-shell";

// The panel follows the rail (181): Scheduled, Library and Artifacts show
// their own navigation under New chat and Search; Chats keeps the chat
// list; Classic keeps the chat list everywhere. And a page's title shows
// once: its own heading, not the header's as well.

const where = vi.hoisted(() => ({ pathname: "/library", search: "" }));
vi.mock("next/navigation", () => ({
  usePathname: () => where.pathname,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(where.search),
}));

beforeAll(async () => {
  await page.viewport(1280, 800);
});

afterEach(cleanup);

const dotConversation = fixtureId("conversation", 7);
const dot = {
  autoApproveTools: [],
  avatar: { color: "blue", style: "dot" },
  conversationId: dotConversation,
  createdAt: "2026-10-01T09:00:00.000Z",
  enabled: true,
  handle: "dot",
  id: fixtureId("dot", 1),
  instructions: "",
  lastRun: null,
  lastViewedAt: null,
  name: "Dot",
  nextRunAt: "2099-10-21T08:00:00.000Z",
  ownerId: fixtureId("user", 1),
  primary: true,
  rules: "",
  sandboxProvider: null,
  schedules: [
    {
      createdAt: "2026-10-01T09:00:00.000Z",
      cron: "0 8 * * *",
      dotId: fixtureId("dot", 1),
      enabled: true,
      id: fixtureId("dotSchedule", 1),
      lastRunAt: null,
      lastStatus: null,
      nextRunAt: "2099-10-21T08:00:00.000Z",
      prompt: "Morning brief\nWith the weather",
      timezone: "UTC",
      updatedAt: "2026-10-01T09:00:00.000Z",
    },
    {
      createdAt: "2026-10-01T09:00:00.000Z",
      cron: "0 18 * * 5",
      dotId: fixtureId("dot", 1),
      enabled: false,
      id: fixtureId("dotSchedule", 2),
      lastRunAt: null,
      lastStatus: null,
      nextRunAt: null,
      prompt: "Weekly review",
      timezone: "UTC",
      updatedAt: "2026-10-01T09:00:00.000Z",
    },
  ],
  status: "idle",
  target: { modelId: "m", providerId: "p", type: "model" },
  unread: false,
  unreadRuns: 0,
  updatedAt: "2026-10-01T09:00:00.000Z",
};

const artifact = {
  id: fixtureId("artifact", 1),
  kind: "html",
  title: "Launch page",
};

const api = () =>
  fakeApi({
    "GET /artifacts": () => ({ items: [artifact], nextCursor: null }),
    "GET /conversations": () => ({ items: [conversation], nextCursor: null }),
    "GET /dots": () => [dot],
  });

const show = (
  pathname: string,
  search = "",
  layout: "classic" | "rail" = "rail"
) => {
  where.pathname = pathname;
  where.search = search;
  renderWithApi(
    <AppFrameProvider value={frame({ sidebarLayout: layout })}>
      <SidebarLayoutProvider value={layout}>
        <PageShell>
          <p>Page</p>
        </PageShell>
      </SidebarLayoutProvider>
    </AppFrameProvider>,
    api()
  );
  return within(screen.getByRole("complementary", { name: "Chats" }));
};

const NEW_CHAT = /New chat/;
const MORNING_BRIEF = /Morning brief/;
const WEEKLY_REVIEW = /Weekly review/;
const SEARCH = /Search/;

/** New chat and Search stay at the top of every panel. */
const actionsOf = (panel: ReturnType<typeof show>) => [
  panel.queryByRole("button", { name: NEW_CHAT }),
  panel.queryByRole("button", { name: SEARCH }),
];

describe("the panel follows the rail (181)", () => {
  it("Scheduled lists each task with its next run, and New task", async () => {
    const panel = show("/dots");
    expect(actionsOf(panel).every(Boolean)).toBe(true);
    const nav = within(
      await panel.findByRole("navigation", { name: "Scheduled" })
    );
    const brief = await nav.findByRole("link", { name: MORNING_BRIEF });
    expect(brief.getAttribute("href")).toBe(
      `/c/${dotConversation}?dot=scheduled`
    );
    expect(brief.textContent).not.toContain("With the weather");
    expect(
      nav.getByRole("link", { name: WEEKLY_REVIEW }).textContent
    ).toContain("Paused");
    expect(
      nav.getByRole("link", { name: "New task" }).getAttribute("href")
    ).toBe(`/c/${dotConversation}?dot=scheduled`);
    // Not the chat list.
    expect(panel.queryByText(conversation.title ?? "")).toBeNull();
    expect(
      screen
        .getByRole("navigation", { name: "Sidebar rail" })
        .querySelector('[aria-current="page"]')
        ?.getAttribute("aria-label")
    ).toBe("Scheduled");
  });

  it("Library shows its kinds and sources, the current one filled", () => {
    const panel = show("/library", "kind=skill");
    expect(actionsOf(panel).every(Boolean)).toBe(true);
    const nav = within(panel.getByRole("navigation", { name: "Library" }));
    for (const name of [
      "All",
      "Agents",
      "Prompts",
      "Skills",
      "MCP servers",
      "Shared with me",
      "Team & org",
    ]) {
      expect(nav.getByRole("link", { name })).toBeTruthy();
    }
    expect(nav.getByRole("link", { name: "Skills" }).getAttribute("href")).toBe(
      "/library?kind=skill"
    );
    expect(
      nav.getByRole("link", { name: "Skills" }).getAttribute("aria-current")
    ).toBe("page");
    expect(
      nav.getByRole("link", { name: "All" }).getAttribute("aria-current")
    ).toBeNull();
    expect(
      nav.getByRole("link", { name: "Shared with me" }).getAttribute("href")
    ).toBe("/library?tab=shared");
  });

  it("Artifacts shows the kinds and the recent artifacts", async () => {
    const panel = show("/artifacts");
    expect(actionsOf(panel).every(Boolean)).toBe(true);
    const nav = within(panel.getByRole("navigation", { name: "Artifacts" }));
    expect(
      nav.getByRole("link", { name: "All kinds" }).getAttribute("aria-current")
    ).toBe("page");
    const recent = await nav.findByRole("link", { name: "Launch page" });
    expect(recent.getAttribute("href")).toBe(`/artifacts/${artifact.id}`);
  });

  it("Chats keeps the chat list", async () => {
    const panel = show("/settings/profile");
    expect(await panel.findByText(conversation.title ?? "")).toBeTruthy();
    expect(panel.queryByRole("navigation", { name: "Library" })).toBeNull();
  });

  it("Classic keeps the chat list on every page", async () => {
    const panel = show("/library", "", "classic");
    expect(await panel.findByText(conversation.title ?? "")).toBeTruthy();
    expect(panel.queryByRole("navigation", { name: "Library" })).toBeNull();
  });
});

describe("a page's title shows once (181)", () => {
  it("leaves the header's title to pages without a heading", () => {
    show("/library");
    const header = screen.getByRole("banner");
    expect(header.textContent).not.toContain("Library");
  });

  it("still names settings in the header", () => {
    show("/settings/profile");
    expect(screen.getByRole("banner").textContent).toContain("Settings");
  });
});
