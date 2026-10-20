import {
  cleanup,
  configure,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type {
  LibraryItem,
  LibraryKind,
} from "@workspace/contract/schemas/library";
import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";

import { createFakeLibraryClient } from "../testing/fake-client";
import { createTestProviders } from "../testing/providers";
import { LibraryIndex, type LibraryIndexProps } from "./library-index";

// The fake server answers after 1.5 s so optimistic states are observable on
// slow CI runners; async queries must outlast it.
configure({ asyncUtilTimeout: 5000 });

afterEach(() => {
  cleanup();
});

const AGENT_CHAT = /^\/\?agent=/;

const itemHref = (item: LibraryItem) => `/library/${item.id}`;
const newHref = (kind: LibraryKind) => `/library/new/${kind}`;

const renderIndex = (
  client = createFakeLibraryClient(),
  filter: Pick<LibraryIndexProps, "kind" | "tab"> = {}
) => {
  const providers = createTestProviders(client);
  return render(
    providers.wrap(
      <LibraryIndex itemHref={itemHref} newHref={newHref} {...filter} />
    )
  );
};

const names = () =>
  screen
    .getAllByRole("article")
    .map((card) => within(card).getByRole("link").textContent);

describe("LibraryIndex", () => {
  it("lists my library, what's shared with me, and my spaces' items", async () => {
    const view = renderIndex();
    await waitFor(() =>
      expect(names()).toEqual(["Changelog", "Explain a concept", "Docs"])
    );
    expect(screen.getByRole("heading", { name: "Library" })).toBeTruthy();
    view.unmount();

    const shared = renderIndex(undefined, { tab: "shared" });
    await waitFor(() => expect(names()).toEqual(["Meeting notes"]));
    expect(screen.getByText("Can use")).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Shared with me" })
    ).toBeTruthy();
    shared.unmount();

    renderIndex(undefined, { tab: "libraries" });
    await waitFor(() => expect(names()).toEqual(["Reviewer"]));
    expect(screen.getByText("Maintainer")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Spaces" })).toBeTruthy();
  });

  it("leaves choosing the tab and kind to the page's panel", async () => {
    renderIndex();
    await waitFor(() => expect(names()).toHaveLength(3));
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.queryByRole("group", { name: "Kind" })).toBeNull();
  });

  it("shows one kind, named in the heading", async () => {
    renderIndex(undefined, { kind: "prompt" });
    await waitFor(() => expect(names()).toEqual(["Explain a concept"]));
    expect(screen.getByRole("heading", { name: "Prompts" })).toBeTruthy();
  });

  it("searches", async () => {
    renderIndex();
    await waitFor(() => expect(names()).toHaveLength(3));
    await userEvent.fill(
      screen.getByRole("searchbox", { name: "Search the library" }),
      "change"
    );
    await waitFor(() => expect(names()).toEqual(["Changelog"]));
  });

  it("says so when a tab is empty", async () => {
    renderIndex(createFakeLibraryClient({ empty: true }));
    expect(await screen.findByText("Nothing here yet")).toBeTruthy();
  });

  it("deletes at once after confirming, and puts it back if the server refuses", async () => {
    const client = createFakeLibraryClient();
    // Wide enough that the optimistic state is observable on a slow CI runner.
    client.setLatency(1500);
    client.failNext("library.delete", "FORBIDDEN");
    renderIndex(client);
    await waitFor(() => expect(names()).toHaveLength(3));

    await userEvent.click(
      screen.getByRole("button", { name: "Actions for Docs" })
    );
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Delete" })
    );
    // The menu finishes closing before the confirmation takes clicks.
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    await userEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Delete",
      })
    );
    // Optimistic: gone before the server answers…
    await waitFor(() =>
      expect(names()).toEqual(["Changelog", "Explain a concept"])
    );
    // …and back when it refuses.
    await waitFor(() =>
      expect(names()).toEqual(["Changelog", "Explain a concept", "Docs"])
    );
  });

  it("links a published agent to a chat with it (044)", async () => {
    const chatHref = (item: LibraryItem) => `/?agent=${item.id}`;
    const providers = createTestProviders(createFakeLibraryClient());
    const spaces = render(
      providers.wrap(
        <LibraryIndex
          chatHref={chatHref}
          itemHref={itemHref}
          newHref={newHref}
          tab="libraries"
        />
      )
    );
    const link = await screen.findByRole("link", {
      name: "Use in chat Reviewer",
    });
    expect(link.getAttribute("href")).toMatch(AGENT_CHAT);
    spaces.unmount();
    // Prompts never answer a chat.
    render(
      providers.wrap(
        <LibraryIndex
          chatHref={chatHref}
          itemHref={itemHref}
          newHref={newHref}
        />
      )
    );
    await screen.findByText("Explain a concept");
    expect(
      screen.queryByRole("link", { name: "Use in chat Explain a concept" })
    ).toBeNull();
  });
});
