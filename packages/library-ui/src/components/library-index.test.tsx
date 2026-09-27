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
import { LibraryIndex } from "./library-index";

// The fake server answers after 1.5 s so optimistic states are observable on
// slow CI runners; async queries must outlast it.
configure({ asyncUtilTimeout: 5000 });

afterEach(() => {
  cleanup();
});

const AGENT_CHAT = /^\/\?agent=/;

const itemHref = (item: LibraryItem) => `/library/${item.id}`;
const newHref = (kind: LibraryKind) => `/library/new/${kind}`;

const renderIndex = (client = createFakeLibraryClient()) => {
  const providers = createTestProviders(client);
  render(
    providers.wrap(<LibraryIndex itemHref={itemHref} newHref={newHref} />)
  );
  return providers;
};

const names = () =>
  screen
    .getAllByRole("article")
    .map((card) => within(card).getByRole("link").textContent);

describe("LibraryIndex", () => {
  it("lists my library, what's shared with me, and team and org items", async () => {
    renderIndex();
    await waitFor(() =>
      expect(names()).toEqual(["Changelog", "Explain a concept", "Docs"])
    );

    await userEvent.click(screen.getByRole("tab", { name: "Shared with me" }));
    await waitFor(() => expect(names()).toEqual(["Meeting notes"]));
    expect(screen.getByText("Can use")).toBeTruthy();

    await userEvent.click(screen.getByRole("tab", { name: "Team & org" }));
    await waitFor(() => expect(names()).toEqual(["Reviewer"]));
    expect(screen.getByText("Maintainer")).toBeTruthy();
  });

  it("searches and filters by kind", async () => {
    renderIndex();
    await waitFor(() => expect(names()).toHaveLength(3));
    await userEvent.fill(
      screen.getByRole("searchbox", { name: "Search the library" }),
      "change"
    );
    await waitFor(() => expect(names()).toEqual(["Changelog"]));
    await userEvent.fill(
      screen.getByRole("searchbox", { name: "Search the library" }),
      ""
    );
    await userEvent.click(screen.getByRole("button", { name: "Prompts" }));
    await waitFor(() => expect(names()).toEqual(["Explain a concept"]));
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
    render(
      providers.wrap(
        <LibraryIndex
          chatHref={chatHref}
          itemHref={itemHref}
          newHref={newHref}
        />
      )
    );
    await userEvent.click(
      await screen.findByRole("tab", { name: "Team & org" })
    );
    const link = await screen.findByRole("link", {
      name: "Use in chat Reviewer",
    });
    expect(link.getAttribute("href")).toMatch(AGENT_CHAT);
    // Prompts never answer a chat.
    await userEvent.click(screen.getByRole("tab", { name: "My library" }));
    await screen.findByText("Explain a concept");
    expect(
      screen.queryByRole("link", { name: "Use in chat Explain a concept" })
    ).toBeNull();
  });
});
