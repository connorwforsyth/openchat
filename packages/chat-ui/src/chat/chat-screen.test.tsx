import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { contextOptionsFromMe } from "@workspace/composer/options";
import { fixtureId, me, teamPlatform } from "@workspace/contract/fixtures";
import type { ChatContext } from "@workspace/contract/schemas/tenancy";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import {
  chatArtifacts,
  initialLeafId,
  participants,
  sidebarChats,
  treeMessages,
} from "../fixtures";
import { localBranchPath } from "../model/branch";
import { SHELL_LAYOUT_STORAGE_KEY } from "../shell/use-shell-layout";
import { modKey, renderWithI18n } from "../testing/render";
import { ChatScreen, type ChatScreenProps } from "./chat-screen";

const path = localBranchPath(treeMessages, initialLeafId);
if (!path) {
  throw new Error("fixture branch path");
}
const now = new Date(Date.UTC(2026, 8, 27, 12));
const chats = sidebarChats(now);
const contextOptions = contextOptionsFromMe(me, ["personal", "team", "org"]);
const platformContext: ChatContext = { id: teamPlatform.id, type: "team" };

const props = (overrides: Partial<ChatScreenProps> = {}): ChatScreenProps => ({
  actions: { onSelectBranch: vi.fn() },
  artifacts: {
    artifacts: chatArtifacts,
    onSelect: vi.fn(),
    selection: null,
    versions: [],
  },
  composer: { onSubmit: vi.fn() },
  conversation: {
    context: platformContext,
    contextLocked: true,
    contextOptions,
    id: path.conversationId,
    participants,
    title: "Postgres full-text search vs Meilisearch",
  },
  messages: path.messages,
  onNewChat: vi.fn(),
  sandbox: null,
  siblings: path.siblings,
  sidebar: {
    account: {
      onSignOut: vi.fn(),
      onThemeChange: vi.fn(),
      theme: "system",
      user: { email: "ada@example.test", image: null, name: "Ada" },
    },
    activeId: path.conversationId,
    chats,
    now,
    onArchive: vi.fn(),
    onRename: vi.fn(),
    onRestore: vi.fn(),
    onSelect: vi.fn(),
    onTogglePin: vi.fn(),
  },
  ...overrides,
});

beforeEach(() => {
  window.localStorage.removeItem(SHELL_LAYOUT_STORAGE_KEY);
});

afterEach(() => {
  cleanup();
});

const header = () => {
  const element = document.querySelector<HTMLElement>(
    '[data-slot="app-header"]'
  );
  if (!element) {
    throw new Error("no header");
  }
  return within(element);
};

describe("header branch switcher", () => {
  it("shows the latest fork and steps it with the buttons and [ ]", async () => {
    const onSelectBranch = vi.fn();
    renderWithI18n(<ChatScreen {...props({ actions: { onSelectBranch } })} />);
    // The edited message (2 of 2) is the deepest fork on this branch.
    expect(header().getByText("2/2")).toBeTruthy();

    await userEvent.click(
      header().getByRole("button", { name: "Previous branch" })
    );
    expect(onSelectBranch).toHaveBeenLastCalledWith(fixtureId("message", 109));

    onSelectBranch.mockClear();
    // `[[` is a literal "[" in user-event's key syntax.
    await userEvent.keyboard("[[");
    expect(onSelectBranch).toHaveBeenCalledWith(fixtureId("message", 109));
    // Already the last branch: `]` has nowhere to go.
    onSelectBranch.mockClear();
    await userEvent.keyboard("]]");
    expect(onSelectBranch).not.toHaveBeenCalled();
  });
});

describe("chat context chip", () => {
  it("is locked after the first message", () => {
    renderWithI18n(<ChatScreen {...props()} />);
    const chip = header().getByRole("button", {
      name: "Chat context: Platform, locked",
    });
    // Still focusable, so the tooltip can say why, but it opens no menu.
    expect(chip.getAttribute("aria-disabled")).toBe("true");
    expect(chip.getAttribute("aria-haspopup")).toBeNull();
  });

  it("can change before the first message", async () => {
    const onContextChange = vi.fn();
    const base = props();
    renderWithI18n(
      <ChatScreen
        {...props({
          conversation: {
            ...base.conversation,
            contextLocked: false,
            id: null,
            onContextChange,
            participants: [],
            title: null,
          },
          messages: [],
          siblings: [],
        })}
      />
    );
    expect(screen.getByText("What are we working on?")).toBeTruthy();
    await userEvent.click(
      header().getByRole("button", { name: "Chat context: Platform" })
    );
    await userEvent.click(
      await screen.findByRole("menuitemradio", { name: "Personal" })
    );
    expect(onContextChange).toHaveBeenCalledWith({ type: "personal" });
  });
});

describe("shortcuts", () => {
  it("run from the page but not while typing", async () => {
    const onNewChat = vi.fn();
    renderWithI18n(<ChatScreen {...props({ onNewChat })} />);

    await userEvent.keyboard("n");
    expect(onNewChat).toHaveBeenCalledTimes(1);

    // Wait for the editor to replace the shell, so the click lands on it.
    const editor = await waitFor(() => {
      const found = document.querySelector<HTMLElement>(
        '[contenteditable="true"]'
      );
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    await userEvent.click(editor);
    await userEvent.keyboard("n");
    expect(onNewChat).toHaveBeenCalledTimes(1);
  });

  it("/ focuses the composer; ⌘B (Ctrl+B) toggles the sidebar even while typing", async () => {
    renderWithI18n(<ChatScreen {...props()} />);
    await userEvent.keyboard("/");
    await waitFor(() =>
      expect(document.activeElement?.getAttribute("aria-label")).toBe("Message")
    );

    expect(screen.getByRole("complementary", { name: "Chats" })).toBeTruthy();
    const mod = modKey();
    await userEvent.keyboard(`{${mod}>}b{/${mod}}`);
    expect(screen.queryByRole("complementary", { name: "Chats" })).toBeNull();
    // The layout is remembered.
    expect(
      JSON.parse(window.localStorage.getItem(SHELL_LAYOUT_STORAGE_KEY) ?? "{}")
    ).toMatchObject({ sidebarOpen: false });
  });

  it("A toggles the artifacts panel and J/K move between chats", async () => {
    const onSelect = vi.fn();
    const base = props();
    renderWithI18n(
      <ChatScreen {...props({ sidebar: { ...base.sidebar, onSelect } })} />
    );
    await userEvent.keyboard("a");
    expect(
      (await screen.findByRole("tab", { name: "Artifacts" })).getAttribute(
        "aria-selected"
      )
    ).toBe("true");
    await userEvent.keyboard("a");
    expect(screen.queryByRole("tab", { name: "Artifacts" })).toBeNull();

    // The open chat is first in "Today" after the pinned one.
    await userEvent.keyboard("j");
    expect(onSelect).toHaveBeenLastCalledWith(chats[2]?.id);
    await userEvent.keyboard("k");
    expect(onSelect).toHaveBeenLastCalledWith(chats[1]?.id);
  });

  it("? opens the shortcut list", async () => {
    renderWithI18n(<ChatScreen {...props()} />);
    await userEvent.keyboard("?");
    const dialog = await screen.findByRole("dialog", {
      name: "Keyboard shortcuts",
    });
    expect(within(dialog).getByText("Toggle sidebar")).toBeTruthy();
  });
});

describe("sidebar", () => {
  it("groups chats by date and archives with an undo", async () => {
    const onArchive = vi.fn();
    const onRestore = vi.fn();
    const base = props();
    renderWithI18n(
      <ChatScreen
        {...props({ sidebar: { ...base.sidebar, onArchive, onRestore } })}
      />
    );
    const sidebar = within(
      screen.getByRole("complementary", { name: "Chats" })
    );
    for (const heading of [
      "Pinned",
      "Today",
      "Yesterday",
      "Previous 7 days",
      "Older",
    ]) {
      expect(sidebar.getByRole("heading", { name: heading })).toBeTruthy();
    }

    const title = chats[2]?.title ?? "";
    await userEvent.click(
      sidebar.getByRole("button", { name: `Actions for ${title}` })
    );
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Archive" })
    );
    expect(onArchive).toHaveBeenCalledWith(chats[2]?.id);

    await userEvent.click(await screen.findByRole("button", { name: "Undo" }));
    expect(onRestore).toHaveBeenCalledWith(chats[2]?.id);
  });
});

describe("narrow screens", () => {
  beforeEach(async () => {
    await page.viewport(375, 812);
  });
  afterEach(async () => {
    await page.viewport(1280, 800);
  });

  const sheet = (name: string) => screen.findByRole("dialog", { name });

  it("opens the sidebar as a sheet that traps focus and closes on Esc", async () => {
    renderWithI18n(<ChatScreen {...props()} />);
    // No sidebar beside the chat; the toggle opens it over the chat instead.
    expect(screen.queryByRole("complementary", { name: "Chats" })).toBeNull();
    const toggle = header().getByRole("button", { name: "Toggle sidebar" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    await userEvent.click(toggle);
    const chatsSheet = await sheet("Chats");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    await waitFor(() =>
      expect(chatsSheet.contains(document.activeElement)).toBe(true)
    );
    // Tabbing cycles inside the sheet rather than escaping to the page.
    for (let step = 0; step < 12; step += 1) {
      // biome-ignore lint/performance/noAwaitInLoops: each Tab depends on where the last one left focus.
      await userEvent.tab();
      expect(chatsSheet.contains(document.activeElement)).toBe(true);
    }

    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Chats" })).toBeNull()
    );
    // The wide layout's remembered sidebar is left alone.
    expect(window.localStorage.getItem(SHELL_LAYOUT_STORAGE_KEY)).not.toContain(
      '"sidebarOpen":false'
    );
  });

  it("closes the sidebar sheet once a chat is picked", async () => {
    const onSelect = vi.fn();
    const base = props();
    renderWithI18n(
      <ChatScreen {...props({ sidebar: { ...base.sidebar, onSelect } })} />
    );
    const mod = modKey();
    await userEvent.keyboard(`{${mod}>}b{/${mod}}`);
    const chatsSheet = within(await sheet("Chats"));
    const title = chats[2]?.title ?? "";
    // The keyboard picks it: the page has no stylesheet in tests, so the
    // row sits below the fold of a scroll-locked page.
    chatsSheet.getByRole("button", { name: title }).focus();
    await userEvent.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith(chats[2]?.id);
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Chats" })).toBeNull()
    );
  });

  it("shows the side panel as a bottom sheet, opened from the overflow menu", async () => {
    renderWithI18n(<ChatScreen {...props()} />);
    // Share and the panel buttons move into the overflow menu.
    expect(header().queryByRole("button", { name: "Share" })).toBeNull();
    await userEvent.click(
      header().getByRole("button", { name: "More actions" })
    );
    await userEvent.click(
      await screen.findByRole("menuitemcheckbox", { name: "Artifacts panel" })
    );
    const panelSheet = within(await sheet("Side panel"));
    expect(
      panelSheet
        .getByRole("tab", { name: "Artifacts" })
        .getAttribute("aria-selected")
    ).toBe("true");

    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Side panel" })).toBeNull()
    );
    expect(
      JSON.parse(window.localStorage.getItem(SHELL_LAYOUT_STORAGE_KEY) ?? "{}")
    ).toMatchObject({ panel: null });
  });

  it("goes back to the side-by-side layout when the screen widens", async () => {
    renderWithI18n(<ChatScreen {...props()} />);
    await userEvent.keyboard("a");
    expect(await sheet("Side panel")).toBeTruthy();

    await page.viewport(1280, 800);
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Side panel" })).toBeNull()
    );
    expect(
      screen.getByRole("complementary", { name: "Side panel" })
    ).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "Chats" })).toBeTruthy();
  });
});
