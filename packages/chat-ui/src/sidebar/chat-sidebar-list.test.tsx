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

// The sidebar's list (176–179): needs attention, sort, paging, bulk select,
// the archive view, the keyboard set and the collapsed rail.

const BOTH_TITLES = /^(Old but busy|Made yesterday)$/;

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

describe("Needs attention", () => {
  it("lists unread and running chats, and hides when there are none", () => {
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
    const attention = section("Needs attention");
    expect(within(attention).getByText("Busy one")).toBeVisible();
    expect(within(attention).getByText("Fresh reply")).toBeVisible();
    expect(within(attention).queryByText("Read one")).toBeNull();
    unmount();
    render(<ChatSidebar {...base({ chats: [chat(1, "Read one")] })} />);
    expect(
      screen.queryByRole("region", { name: "Needs attention" })
    ).toBeNull();
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
  it("keeps date headings by last update, and goes flat sorted by creation", async () => {
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
    expect(section("Today")).toBeVisible();
    expect(section("Yesterday")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Sort chats" }));
    await userEvent.click(
      await screen.findByRole("menuitemradio", { name: "Created" })
    );
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Today" })).toBeNull()
    );
    const titles = within(section("Chats"))
      .getAllByRole("button", { name: BOTH_TITLES })
      .map((each) => each.textContent);
    expect(titles).toEqual(["Made yesterday", "Old but busy"]);
    expect(window.localStorage.getItem("sidebar.sort")).toBe("created");
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
      expect(document.body.textContent).toContain("Archived 2; 1 failed")
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
  it("offers the actions and a count of chats needing attention", async () => {
    const onSelect = vi.fn();
    const onExpand = vi.fn();
    const props = base({
      chats: [chat(1, "Fresh", { read: "unread" })],
      onSelect,
    });
    render(<SidebarRail {...props} onExpand={onExpand} />);
    await userEvent.click(
      screen.getByRole("button", { name: "1 chat needs attention" })
    );
    expect(onSelect).toHaveBeenCalledWith("c1");
    await userEvent.click(screen.getByRole("button", { name: "Open sidebar" }));
    expect(onExpand).toHaveBeenCalled();
  });
});
