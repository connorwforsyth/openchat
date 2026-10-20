import { cleanup, screen } from "@testing-library/react";
import { ToastProvider } from "@workspace/ui/components/toast";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithI18n } from "../testing/render";
import { ChatSidebar, type ChatSidebarProps } from "./chat-sidebar";

// The sidebar's Dot slot (172, 181): ChatGPT's order, so the actions and
// pages first, then your Dot's row; and no Dots link, since there's one Dot.

const NEW_CHAT = /New chat/;
const WHITESPACE = /\s/;

afterEach(cleanup);

const render = (ui: ReactElement) =>
  renderWithI18n(<ToastProvider>{ui}</ToastProvider>);

const props: ChatSidebarProps = {
  account: {
    onSignOut: vi.fn(),
    onThemeChange: vi.fn(),
    theme: "light",
    user: { email: "ada@example.com", image: null, name: "Ada" },
  },
  activeId: null,
  chats: [],
  dotsHref: "/dots",
  libraryHref: "/library",
  onArchive: vi.fn(),
  onNewChat: vi.fn(),
  onRename: vi.fn(),
  onRestore: vi.fn(),
  onSelect: vi.fn(),
  onTogglePin: vi.fn(),
};

describe("ChatSidebar Dot slot", () => {
  it("has no Dots link", () => {
    render(<ChatSidebar {...props} dots={<a href="/dots">My Dots</a>} />);
    expect(screen.queryByRole("link", { name: "Dots" })).toBeNull();
    expect(screen.queryByRole("link", { name: "My Dots" })).toBeNull();
  });

  it("puts `top` after the actions and pages", () => {
    render(<ChatSidebar {...props} top={<a href="/c/1">Pip</a>} />);
    const pip = screen.getByRole("link", { name: "Pip" });
    const newChat = screen.getByRole("button", { name: NEW_CHAT });
    const library = screen.getByRole("link", { name: "Library" });
    expect(newChat.compareDocumentPosition(pip)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
    expect(library.compareDocumentPosition(pip)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
  });
});

describe("ChatSidebar pages (181)", () => {
  it("lists every page in order when there's no rail", () => {
    render(
      <ChatSidebar
        {...props}
        artifactsHref="/artifacts"
        onOpenPalette={vi.fn()}
        schedulesHref="/dots"
      />
    );
    const nav = screen.getByRole("navigation", { name: "Primary" });
    const names = [...nav.querySelectorAll("a, button")].map(
      (item) => item.textContent?.trim() ?? ""
    );
    expect(names.map((name) => name.split(WHITESPACE)[0])).toEqual([
      "New",
      "Search",
      "Library",
      "Artifacts",
      "Scheduled",
    ]);
    for (const link of nav.querySelectorAll("a")) {
      expect(link.className).not.toContain("md:hidden");
    }
  });

  it("leaves the pages to the rail on wide screens", () => {
    render(<ChatSidebar {...props} railed schedulesHref="/dots" />);
    const scheduled = screen.getByRole("link", { name: "Scheduled" });
    expect(scheduled.className).toContain("md:hidden");
  });
});
