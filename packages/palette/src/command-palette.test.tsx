import { setupI18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { fixtureId, fixtureTime } from "@workspace/contract/fixtures";
import type { SearchHit } from "@workspace/contract/schemas/search";
import { ShortcutsProvider } from "@workspace/shortcuts/react/context";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import { CommandPalette, type CommandPaletteProps } from "./command-palette";
import { paletteAction } from "./items";

const i18n = setupI18n({ locale: "en", messages: { en: {} } });

const cachedChats = () => [
  {
    archived: false,
    id: fixtureId("conversation", 1),
    pinned: false,
    title: "Deploy checklist",
    updatedAt: fixtureTime(1),
  },
];

const serverHit: SearchHit = {
  conversationId: fixtureId("conversation", 2),
  highlights: [{ end: 6, start: 0 }],
  messageId: fixtureId("message", 2),
  rank: 1,
  role: "assistant",
  snippet: "deploy with blue/green",
  title: "Infra questions",
  updatedAt: fixtureTime(2),
};

type Overrides = Partial<CommandPaletteProps>;

const Harness = (overrides: Overrides) => {
  const [open, setOpen] = useState(false);
  return (
    <CommandPalette
      cachedChats={cachedChats}
      onAskAi={vi.fn()}
      onOpenChange={setOpen}
      onOpenLibraryItem={vi.fn()}
      onSelectChat={vi.fn()}
      open={open}
      {...overrides}
    />
  );
};

const renderPalette = (overrides: Overrides = {}) =>
  render(
    <I18nProvider i18n={i18n}>
      <ShortcutsProvider platform="mac">
        <Harness {...overrides} />
      </ShortcutsProvider>
    </I18nProvider>
  );

// Unstyled in tests, Base UI's modal backdrop covers the popup for real
// pointer hit-testing, so options are chosen with dispatched clicks.
const openPalette = async () => {
  await userEvent.keyboard("{Meta>}k{/Meta}");
  return screen.findByRole("combobox");
};

afterEach(() => {
  cleanup();
});

describe("CommandPalette", () => {
  it("opens on ⌘K with actions and recent chats", async () => {
    const newChat = vi.fn();
    renderPalette({
      actions: [
        paletteAction(
          {
            id: "new",
            section: "actions",
            shortcutId: "chat.new",
            title: "New chat",
          },
          newChat
        ),
      ],
    });
    await openPalette();
    expect(screen.getByText("Recent chats")).toBeTruthy();
    expect(screen.getByText("Deploy checklist")).toBeTruthy();
    await userEvent.keyboard("{Enter}");
    expect(newChat).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("combobox")).toBeNull());
  });

  it("shows cached chats at once, then merges server hits below them", async () => {
    let resolve: (hits: readonly SearchHit[]) => void = () => undefined;
    const searchChats = vi.fn(
      () =>
        new Promise<readonly SearchHit[]>((onResolve) => {
          resolve = onResolve;
        })
    );
    const onSelectChat = vi.fn();
    renderPalette({ onSelectChat, searchChats });
    await openPalette();
    await userEvent.keyboard("deploy");
    expect(screen.getByText("Deploy checklist")).toBeTruthy();
    expect(screen.queryByText("Infra questions")).toBeNull();

    // On a slow runner the debounce can fire mid-typing ("dep"); what matters is
    // that the full query is searched last and only its answer is merged.
    await waitFor(() => expect(searchChats.mock.lastCall?.[0]).toBe("deploy"));
    resolve([serverHit]);
    const merged = await screen.findByText("Infra questions");
    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options.indexOf("Deploy checklist")).toBeLessThan(
      options.findIndex((text) => text?.includes("Infra questions"))
    );

    fireEvent.click(merged);
    expect(onSelectChat).toHaveBeenCalledWith(
      fixtureId("conversation", 2),
      fixtureId("message", 2)
    );
  });

  it("offers Ask AI with the typed text", async () => {
    const onAskAi = vi.fn();
    renderPalette({ onAskAi });
    await openPalette();
    await userEvent.keyboard("what is a monad");
    fireEvent.click(
      screen.getByRole("option", { name: "Ask AI: “what is a monad”" })
    );
    expect(onAskAi).toHaveBeenCalledWith("what is a monad");
  });

  it("offers context actions and hides a locked chat context", async () => {
    const onModel = vi.fn();
    const onContext = vi.fn();
    const onToggle = vi.fn();
    const { unmount } = renderPalette({
      context: {
        chatContext: {
          current: "personal",
          locked: false,
          onSelect: onContext,
          options: [
            { id: "personal", label: "Personal" },
            { id: "team", label: "Platform team" },
          ],
        },
        model: {
          current: "fast",
          onSelect: onModel,
          options: [
            { id: "fast", label: "Fast" },
            { id: "strong", label: "Strong" },
          ],
        },
        sandbox: { available: true, onToggle, open: false },
      },
    });
    await openPalette();
    expect(screen.queryByText("Switch model to Fast")).toBeNull();
    fireEvent.click(screen.getByText("Switch model to Strong"));
    expect(onModel).toHaveBeenCalledWith("strong");
    await openPalette();
    fireEvent.click(screen.getByText("Switch chat context to Platform team"));
    expect(onContext).toHaveBeenCalledWith("team");
    await openPalette();
    fireEvent.click(screen.getByText("Show the sandbox"));
    expect(onToggle).toHaveBeenCalled();
    unmount();

    renderPalette({
      context: {
        chatContext: {
          current: "personal",
          locked: true,
          onSelect: onContext,
          options: [{ id: "team", label: "Platform team" }],
        },
      },
    });
    await openPalette();
    expect(
      screen.queryByText("Switch chat context to Platform team")
    ).toBeNull();
  });

  it("finds library items and settings by name only", async () => {
    const onOpenLibraryItem = vi.fn();
    const onNewChatWithAgent = vi.fn();
    const item = {
      description: "Reviews pull requests",
      id: fixtureId("libraryItem", 1),
      kind: "agent" as const,
      name: "Code reviewer",
    };
    renderPalette({
      library: [item],
      onNewChatWithAgent,
      onOpenLibraryItem,
      settings: [
        paletteAction(
          {
            id: "settings:keys",
            keywords: ["api"],
            section: "settings",
            title: "Provider keys",
          },
          vi.fn()
        ),
      ],
    });
    await openPalette();
    expect(screen.queryByText("Code reviewer")).toBeNull();
    expect(screen.queryByText("Provider keys")).toBeNull();
    await userEvent.keyboard("review");
    expect(screen.getByText("New chat with Code reviewer")).toBeTruthy();
    fireEvent.click(screen.getByText("Code reviewer"));
    expect(onOpenLibraryItem).toHaveBeenCalledWith(item);
    await openPalette();
    await userEvent.keyboard("api");
    expect(screen.getByText("Provider keys")).toBeTruthy();
  });
});
