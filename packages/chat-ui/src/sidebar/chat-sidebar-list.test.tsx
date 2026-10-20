import { cleanup, screen, waitFor, within } from "@testing-library/react";
import type { ConversationId } from "@workspace/contract/schemas/common";
import { Toaster } from "@workspace/ui/components/toast";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import { PlatformProvider } from "../shell/platform";
import { modKey, renderWithI18n } from "../testing/render";
import type { SidebarChat } from "./chat-row";
import { ChatSidebar, type ChatSidebarProps } from "./chat-sidebar";
import { SidebarRail } from "./sidebar-rail";

// The sidebar's list (176–179, 181): Priority, Pinned, one flat Chats list,
// sort, paging, bulk select, the archive view, the keyboard set and the
// collapsed rail.

const BOTH_TITLES = /^(Old but busy|Made yesterday)$/;
const PRIORITY_OPTIONS = { name: "Priority options" };
const MARK_ALL_READ = /Mark all as read/;

afterEach(cleanup);
beforeEach(() => window.localStorage.clear());

const render = (ui: ReactElement) =>
  renderWithI18n(
    <PlatformProvider platform="web">
      <Toaster>{ui}</Toaster>
    </PlatformProvider>
  );

const now = new Date(2026, 9, 20, 18);
const hoursAgo = (hours: number) =>
  new Date(now.getTime() - hours * 3_600_000).toISOString();

const chat = (
  n: number,
  title: string,
  {
    active = n,
    created = n,
    read = "read",
  }: { active?: number; created?: number; read?: "read" | "unread" } = {}
): SidebarChat => ({
  createdAt: hoursAgo(created),
  id: `c${n}` as ConversationId,
  lastMessageAt: hoursAgo(active),
  myState: {
    lastReadAt: read === "read" ? hoursAgo(active) : hoursAgo(active + 1),
  },
  pinned: false,
  title,
  updatedAt: hoursAgo(active),
});

const base = (overrides: Partial<ChatSidebarProps> = {}): ChatSidebarProps => ({
  account: {
    onSignOut: vi.fn(),
    onThemeChange: vi.fn(),
    theme: "light",
    user: { email: "ada@example.com", image: null, name: "Ada" },
  },
  activeId: null,
  chats: [],
  now,
  onArchive: vi.fn(),
  onArchivedViewChange: vi.fn(),
  onArchiveMany: vi.fn(async () => ({ failed: 0 })),
  onNewChat: vi.fn(),
  onRename: vi.fn(),
  onRestore: vi.fn(),
  onSelect: vi.fn(),
  onSetLastRead: vi.fn(),
  onTogglePin: vi.fn(),
  ...overrides,
});

const section = (name: string) => screen.getByRole("region", { name });

describe("Priority", () => {
  it("lists unread and running chats apart from Chats, and hides when there are none", () => {
    const { unmount } = render(
      <ChatSidebar
        {...base({
          chats: [
            chat(1, "Read one"),
            chat(2, "Fresh reply", { read: "unread" }),
            chat(3, "Busy one"),
          ],
          signals: new Map([["c3" as ConversationId, "running" as const]]),
        })}
      />
    );
    const priority = section("Priority");
    expect(within(priority).getByText("Busy one")).toBeVisible();
    expect(within(priority).getByText("Fresh reply")).toBeVisible();
    expect(within(priority).queryByText("Read one")).toBeNull();
    const chats = section("Chats");
    expect(within(chats).getByText("Read one")).toBeVisible();
    expect(within(chats).queryByText("Fresh reply")).toBeNull();
    expect(within(chats).queryByText("Busy one")).toBeNull();
    unmount();
    render(<ChatSidebar {...base({ chats: [chat(1, "Read one")] })} />);
    expect(screen.queryByRole("region", { name: "Priority" })).toBeNull();
  });

  it("counts a never-opened chat with a message as unread", () => {
    const never = {
      ...chat(1, "Scheduled run"),
      myState: { lastReadAt: null },
    };
    render(<ChatSidebar {...base({ chats: [never, chat(2, "Seen")] })} />);
    expect(
      within(section("Priority")).getByText("Scheduled run")
    ).toBeVisible();
  });

  it("marks all as read, and filters to Priority with an empty state", async () => {
    const onSetLastRead = vi.fn();
    const fresh = chat(2, "Fresh reply", { read: "unread" });
    render(
      <ChatSidebar
        {...base({ chats: [chat(1, "Read one"), fresh], onSetLastRead })}
      />
    );
    await userEvent.click(screen.getByRole("button", PRIORITY_OPTIONS));
    await userEvent.click(
      await screen.findByRole("menuitem", { name: MARK_ALL_READ })
    );
    expect(onSetLastRead).toHaveBeenCalledWith(fresh.id, fresh.lastMessageAt);
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    await userEvent.click(screen.getByRole("button", PRIORITY_OPTIONS));
    await userEvent.click(
      await screen.findByRole("menuitemcheckbox", {
        name: "Show only Priority",
      })
    );
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Chats" })).toBeNull()
    );
  });

  it("shows “Nothing needs attention” when filtered with none", async () => {
    render(<ChatSidebar {...base({ chats: [chat(1, "Read one")] })} />);
    await userEvent.keyboard(`{${modKey()}>}{Alt>}u{/Alt}{/${modKey()}}`);
    expect(await screen.findByText("Nothing needs attention")).toBeVisible();
    expect(screen.queryByText("Read one")).toBeNull();
  });

  it("marks a chat unread from its menu", async () => {
    const onSetLastRead = vi.fn();
    const one = chat(1, "Read one");
    render(<ChatSidebar {...base({ chats: [one], onSetLastRead })} />);
    await userEvent.click(
      screen.getByRole("button", { name: "Actions for Read one" })
    );
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Mark as unread" })
    );
    expect(onSetLastRead).toHaveBeenCalledWith(
      one.id,
      new Date(new Date(one.lastMessageAt ?? "").getTime() - 1).toISOString()
    );
  });

  it("keeps your Dot's chat out of the list and opens it with ⌘.", async () => {
    const onSelect = vi.fn();
    render(
      <ChatSidebar
        {...base({
          chats: [chat(1, "Dot thread"), chat(2, "Other")],
          dot: { conversationId: "c1" as ConversationId },
          onSelect,
        })}
      />
    );
    expect(screen.queryByText("Dot thread")).toBeNull();
    await userEvent.keyboard(`{${modKey()}>}.{/${modKey()}}`);
    expect(onSelect).toHaveBeenCalledWith("c1");
  });
});

describe("the chat list", () => {
  it("is one flat list with no date headings, in either sort", async () => {
    render(
      <ChatSidebar
        {...base({
          chats: [
            chat(1, "Old but busy", { active: 1, created: 400 }),
            chat(2, "Made yesterday", { active: 30, created: 30 }),
          ],
        })}
      />
    );
    expect(screen.queryByRole("region", { name: "Today" })).toBeNull();
    const titles = () =>
      within(section("Chats"))
        .getAllByRole("button", { name: BOTH_TITLES })
        .map((each) => each.textContent);
    expect(titles()).toEqual(["Old but busy", "Made yesterday"]);
    await userEvent.click(screen.getByRole("button", { name: "Sort chats" }));
    await userEvent.click(
      await screen.findByRole("menuitemradio", { name: "Created" })
    );
    await waitFor(() =>
      expect(titles()).toEqual(["Made yesterday", "Old but busy"])
    );
    expect(screen.queryByRole("region", { name: "Yesterday" })).toBeNull();
    expect(window.localStorage.getItem("sidebar.sort")).toBe("created");
  });

  it("puts pinned chats in their own section", () => {
    render(
      <ChatSidebar
        {...base({
          chats: [{ ...chat(1, "Pinned one"), pinned: true }, chat(2, "Plain")],
        })}
      />
    );
    expect(within(section("Pinned")).getByText("Pinned one")).toBeVisible();
    expect(within(section("Chats")).queryByText("Pinned one")).toBeNull();
  });

  it("shows 50 rows, then more on request", async () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      chat(i + 1, `Chat ${i + 1}`, { active: 1 + i / 100 })
    );
    render(<ChatSidebar {...base({ chats: many })} />);
    expect(screen.queryByRole("button", { name: "Chat 51" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(screen.getByRole("button", { name: "Chat 60" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
    expect(screen.getByRole("button", { name: "Show less" })).toBeVisible();
  });

  it("selects rows with modifier clicks and archives them together", async () => {
    const onArchiveMany = vi.fn(async () => ({ failed: 1 }));
    render(
      <ChatSidebar
        {...base({
          chats: [chat(1, "One"), chat(2, "Two"), chat(3, "Three")],
          onArchiveMany,
        })}
      />
    );
    await userEvent.keyboard(`{${modKey()}>}`);
    await userEvent.click(screen.getByRole("button", { name: "One" }));
    await userEvent.keyboard(`{/${modKey()}}`);
    await userEvent.keyboard("{Shift>}");
    await userEvent.click(screen.getByRole("button", { name: "Three" }));
    await userEvent.keyboard("{/Shift}");
    expect(screen.getByText("3 selected")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Archive" }));
    expect(onArchiveMany).toHaveBeenCalledWith(["c1", "c2", "c3"]);
    await waitFor(() =>
      expect(document.body.textContent).toContain("Archived 2 chats; 1 failed")
    );
  });

  it("archives with an undo, and ⌘Z undoes it", async () => {
    const onArchive = vi.fn();
    const onRestore = vi.fn();
    render(
      <ChatSidebar
        {...base({ chats: [chat(1, "One")], onArchive, onRestore })}
      />
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Actions for One" })
    );
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Archive" })
    );
    expect(onArchive).toHaveBeenCalledWith("c1");
    expect(await screen.findByText("Archived “One”")).toBeVisible();
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    await userEvent.keyboard(`{${modKey()}>}z{/${modKey()}}`);
    expect(onRestore).toHaveBeenCalledWith("c1");
  });

  it("doesn't undo with ⌘Z once the toast has gone", async () => {
    const onRestore = vi.fn();
    render(<ChatSidebar {...base({ chats: [chat(1, "One")], onRestore })} />);
    await userEvent.click(
      screen.getByRole("button", { name: "Actions for One" })
    );
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Archive" })
    );
    await screen.findByText("Archived “One”");
    await userEvent.click(screen.getByRole("button", { name: "Close toast" }));
    await waitFor(() =>
      expect(screen.queryByText("Archived “One”")).toBeNull()
    );
    await userEvent.keyboard(`{${modKey()}>}z{/${modKey()}}`);
    expect(onRestore).not.toHaveBeenCalled();
  });

  it("keeps the selection when Escape closes a menu", async () => {
    render(
      <ChatSidebar {...base({ chats: [chat(1, "One"), chat(2, "Two")] })} />
    );
    await userEvent.keyboard(`{${modKey()}>}`);
    await userEvent.click(screen.getByRole("button", { name: "One" }));
    await userEvent.keyboard(`{/${modKey()}}`);
    expect(screen.getByText("1 selected")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Sort chats" }));
    await screen.findByRole("menu");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(screen.getByText("1 selected")).toBeVisible();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByText("1 selected")).toBeNull();
  });

  it("opens the archive view, searches and unarchives", async () => {
    const onArchivedViewChange = vi.fn();
    const onRestore = vi.fn();
    render(
      <ChatSidebar
        {...base({
          archivedChats: [chat(8, "Tax return"), chat(9, "Holiday plans")],
          chats: [chat(1, "One")],
          onArchivedViewChange,
          onRestore,
        })}
      />
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Archived chats" })
    );
    expect(onArchivedViewChange).toHaveBeenCalledWith(true);
    await userEvent.type(
      screen.getByRole("textbox", { name: "Search archived chats" }),
      "tax"
    );
    expect(screen.queryByText("Holiday plans")).toBeNull();
    await userEvent.click(
      screen.getByRole("button", { name: "Unarchive Tax return" })
    );
    expect(onRestore).toHaveBeenCalledWith("c8");
    await userEvent.click(
      screen.getByRole("button", { name: "Back to chats" })
    );
    expect(onArchivedViewChange).toHaveBeenLastCalledWith(false);
  });
});

describe("SidebarRail", () => {
  const renderRail = (
    overrides: Partial<Parameters<typeof SidebarRail>[0]> = {}
  ) => {
    const onShowChats = vi.fn();
    render(
      <SidebarRail
        {...base({ chats: [chat(1, "Fresh", { read: "unread" })] })}
        artifactsHref="/artifacts"
        current="chats"
        libraryHref="/library"
        onShowChats={onShowChats}
        scheduledHref="/dots"
        {...overrides}
      />
    );
    return { onShowChats };
  };

  it("is a labelled landmark of labelled destinations", () => {
    renderRail();
    const rail = screen.getByRole("navigation", { name: "Sidebar rail" });
    expect(rail).toBeTruthy();
    expect(screen.getByRole("link", { name: "Library" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Artifacts" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Scheduled" })).toBeTruthy();
  });

  it("marks the current destination, and only that one", () => {
    renderRail({ current: "library" });
    expect(
      screen.getByRole("link", { name: "Library" }).getAttribute("aria-current")
    ).toBe("page");
    expect(
      screen
        .getByRole("link", { name: "Artifacts" })
        .hasAttribute("aria-current")
    ).toBe(false);
  });

  it("badges Chats when something needs attention and shows the chat panel", async () => {
    const { onShowChats } = renderRail();
    await userEvent.click(
      screen.getByRole("button", { name: "Chats, 1 needs attention" })
    );
    expect(onShowChats).toHaveBeenCalledOnce();
  });

  it("shows a tooltip naming the button on hover", async () => {
    renderRail();
    await userEvent.hover(screen.getByRole("link", { name: "Library" }));
    expect(
      await screen.findByText("Library", {
        selector: "[data-slot=tooltip-content] *, [data-slot=tooltip-content]",
      })
    ).toBeTruthy();
  });
});
