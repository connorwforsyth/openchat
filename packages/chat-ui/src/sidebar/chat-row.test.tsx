import { cleanup, screen, waitFor } from "@testing-library/react";
import { fixtureId } from "@workspace/contract/fixtures";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import { renderWithI18n } from "../testing/render";
import { ChatRow, type SidebarChat } from "./chat-row";

// A chat row's actions and inline rename (071).

const chat = (n: number, title: string): SidebarChat => ({
  createdAt: "2026-09-30T12:00:00.000Z",
  id: fixtureId("conversation", n),
  lastMessageAt: null,
  pinned: false,
  title,
  updatedAt: "2026-09-30T12:00:00.000Z",
});

const first = chat(1, "Postgres full-text search vs Meilisearch");
const second = chat(2, "Platform offsite agenda");

const renderRows = () => {
  const onRename = vi.fn();
  const handlers = {
    onArchive: vi.fn(),
    onRename,
    onSelect: vi.fn(),
    onTogglePin: vi.fn(),
  };
  renderWithI18n(
    <ul>
      <ChatRow active chat={first} {...handlers} />
      <ChatRow active={false} chat={second} {...handlers} />
    </ul>
  );
  return { onRename };
};

const actions = (title: string) =>
  screen.getByRole("button", { name: `Actions for ${title}` });

const renameFromMenu = async (title: string) => {
  await userEvent.click(actions(title));
  await userEvent.click(
    await screen.findByRole("menuitem", { name: "Rename" })
  );
  const input = await screen.findByRole("textbox", { name: "Chat title" });
  await waitFor(() => expect(document.activeElement).toBe(input));
  return input;
};

afterEach(cleanup);

describe("ChatRow rename", () => {
  it("renames from a fresh menu", async () => {
    const { onRename } = renderRows();
    await renameFromMenu(first.title ?? "");
    await userEvent.keyboard("Search engines{Enter}");
    expect(onRename).toHaveBeenCalledWith(first.id, "Search engines");
  });

  // The audit's bug: another row's menu opened and closed (Escape or a click
  // away) made Rename do nothing. The menu's focus return blurred the new
  // input, which saved "no change" and closed it.
  it("still renames after another row's menu was opened and closed", async () => {
    const { onRename } = renderRows();
    await userEvent.click(actions(second.title ?? ""));
    await screen.findByRole("menu");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());

    await userEvent.click(actions(second.title ?? ""));
    await screen.findByRole("menu");
    await userEvent.click(document.body);
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());

    const input = await renameFromMenu(first.title ?? "");
    // Nothing closes it on its own before the user types.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(input.isConnected).toBe(true);
    expect(document.activeElement).toBe(input);
    await userEvent.keyboard("Search engines{Enter}");
    expect(onRename).toHaveBeenCalledWith(first.id, "Search engines");
  });

  it("cancels on Escape and on a click away with nothing changed", async () => {
    const { onRename } = renderRows();
    await renameFromMenu(first.title ?? "");
    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: "Chat title" })).toBeNull()
    );
    await renameFromMenu(first.title ?? "");
    await userEvent.click(document.body);
    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: "Chat title" })).toBeNull()
    );
    expect(onRename).not.toHaveBeenCalled();
  });
});
