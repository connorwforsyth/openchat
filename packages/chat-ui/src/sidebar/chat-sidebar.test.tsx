import { cleanup, screen } from "@testing-library/react";
import { ToastProvider } from "@workspace/ui/components/toast";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithI18n } from "../testing/render";
import { ChatSidebar, type ChatSidebarProps } from "./chat-sidebar";

// The sidebar's Dot slots (172): the app's primary Dot above the actions,
// and its Dots list in place of the plain link.

const NEW_CHAT = /New chat/;

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
  onArchive: vi.fn(),
  onNewChat: vi.fn(),
  onRename: vi.fn(),
  onRestore: vi.fn(),
  onSelect: vi.fn(),
  onTogglePin: vi.fn(),
};

describe("ChatSidebar Dot slots", () => {
  it("shows the plain Dots link without slots", () => {
    render(<ChatSidebar {...props} />);
    expect(screen.getByRole("link", { name: "Dots" })).toBeVisible();
  });

  it("puts `top` before the actions and `dots` in place of the link", () => {
    render(
      <ChatSidebar
        {...props}
        dots={<a href="/dots">My Dots</a>}
        top={<a href="/c/1">Pip</a>}
      />
    );
    expect(screen.queryByRole("link", { name: "Dots" })).toBeNull();
    const pip = screen.getByRole("link", { name: "Pip" });
    const newChat = screen.getByRole("button", { name: NEW_CHAT });
    expect(pip.compareDocumentPosition(newChat)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
    expect(screen.getByRole("link", { name: "My Dots" })).toBeVisible();
  });
});
