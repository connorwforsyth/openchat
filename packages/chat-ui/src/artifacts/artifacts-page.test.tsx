import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { createApiClient, createQueryUtils } from "@workspace/client/api";
import { conversation, fixtureId, userAda } from "@workspace/contract/fixtures";
import type { ArtifactListItem } from "@workspace/contract/schemas/files";
import type { Me } from "@workspace/contract/schemas/meta";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import { renderWithI18n } from "../testing/render";
import { ArtifactsPage, type ArtifactsPageProps } from "./artifacts-page";

// An image that never decodes: the thumbnail's `onError`, without the network.
const BROKEN_IMAGE = "data:image/png;base64,AAAA";
const PIXEL =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'/%3E";

const thumbnailOf = (title: string) =>
  screen
    .getByRole("link", { name: title })
    .closest("li")
    ?.querySelector("[data-thumbnail]")
    ?.getAttribute("data-thumbnail");

// The Artifacts page over a fake server: what it lists, how the tabs and
// filters ask, and which actions each row offers.

const now = new Date(2026, 9, 2, 15, 0);
const hoursAgo = (hours: number) =>
  new Date(now.getTime() - hours * 3_600_000).toISOString();

const row = (
  n: number,
  values: Partial<ArtifactListItem> = {}
): ArtifactListItem => ({
  access: "owner",
  canGoToChat: true,
  conversationId: conversation.id,
  createdAt: hoursAgo(100),
  id: fixtureId("artifact", n),
  kind: "markdown",
  latestVersionId: fixtureId("artifactVersion", n),
  messageId: fixtureId("message", n),
  ownerId: userAda.id,
  ownerName: "Ada",
  title: `Artifact ${n}`,
  updatedAt: hoursAgo(50),
  viewedAt: hoursAgo(2),
  visibility: "private",
  ...values,
});

const mine = row(1, { title: "Trip plan" });
const older = row(2, {
  kind: "html",
  title: "Landing page",
  viewedAt: null,
  visibility: "shared",
});
const fromBen = row(3, {
  access: "viewer",
  canGoToChat: false,
  ownerName: "Ben",
  title: "Release notes",
});

const me: Me = {
  orgs: [],
  persistClientCache: true,
  personalOrgId: fixtureId("org", 1),
  teams: [],
  user: {
    email: "ada@example.test",
    id: userAda.id,
    image: null,
    isAdmin: false,
    locale: null,
    name: "Ada",
  },
};

const setup = (
  props: Pick<ArtifactsPageProps, "kinds" | "thumbnailUrl"> = {}
) => {
  const asked: URL[] = [];
  const fetch = (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    asked.push(url);
    const scope = url.searchParams.get("scope");
    let items: ArtifactListItem[] = [mine, older, fromBen];
    if (scope === "shared") {
      items = [fromBen];
    } else if (scope === "mine") {
      items = [mine, older];
    }
    return Promise.resolve(Response.json({ items, nextCursor: null }));
  };
  const api = createQueryUtils(
    createApiClient({ baseUrl: "http://api.test", fetch })
  );
  const onStart = vi.fn();
  const navigate = vi.fn();
  renderWithI18n(
    <QueryClientProvider client={new QueryClient()}>
      <ArtifactsPage
        api={api}
        links={{
          artifact: (id) => `/artifacts/${id}`,
          chat: (id) => `/c/${id}`,
          navigate,
        }}
        me={me}
        now={now}
        onStart={onStart}
        {...props}
      />
    </QueryClientProvider>
  );
  const listed = (pathname: string) =>
    asked.filter((url) => url.pathname === pathname);
  return { listed, navigate, onStart };
};

afterEach(() => {
  cleanup();
});

describe("ArtifactsPage", () => {
  it("lists artifacts by when you last viewed them, with who can see each", async () => {
    setup();
    const trip = await screen.findByRole("link", { name: "Trip plan" });
    expect(trip.getAttribute("href")).toBe(`/artifacts/${mine.id}`);
    const today = screen.getByRole("region", { name: "Today" });
    expect(within(today).getByText("Only you")).toBeTruthy();
    expect(within(today).getByText("Shared by Ben")).toBeTruthy();
    // Never opened: it sorts by its last change, two days ago.
    const landing = screen
      .getByRole("link", { name: "Landing page" })
      .closest("li");
    expect(landing?.textContent).toContain("Shared");
    expect(landing?.textContent).toContain("Updated");
  });

  it("asks for the tab's scope", async () => {
    const { listed } = setup();
    await screen.findByRole("link", { name: "Trip plan" });
    await userEvent.click(screen.getByRole("tab", { name: "Shared with you" }));
    await waitFor(() =>
      expect(
        listed("/api/artifacts").some(
          (url) => url.searchParams.get("scope") === "shared"
        )
      ).toBe(true)
    );
    await waitFor(() =>
      expect(screen.queryByRole("link", { name: "Trip plan" })).toBeNull()
    );
    expect(screen.getByRole("link", { name: "Release notes" })).toBeTruthy();
  });

  it("starts a chat for a new kind from the Make something new cards", async () => {
    const { onStart } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Web page" }));
    expect(onStart).toHaveBeenCalledWith(expect.stringContaining("Web page"));
  });

  it("builds the starter cards from the enabled kinds, with their badges", async () => {
    const { onStart } = setup({
      kinds: ["markdown", "html", "site", "document"],
    });
    const cards = within(
      screen.getByRole("region", { name: "Make something new" })
    ).getAllByRole("button");
    // Markdown has no starter; the rest keep the kit's order.
    expect(cards.map((card) => card.textContent)).toEqual([
      "Document",
      "Web page",
      "BetaSite",
    ]);
    await userEvent.click(cards[2] as HTMLElement);
    expect(onStart).toHaveBeenCalledWith(expect.stringContaining("Site"));
  });

  it("leaves a kind out when the instance hasn't enabled it", () => {
    setup({ kinds: ["html", "mermaid"] });
    const starters = screen.getByRole("region", { name: "Make something new" });
    expect(within(starters).queryByText("Site")).toBeNull();
    expect(
      within(starters).getByRole("button", { name: "Diagram" })
    ).toBeTruthy();
  });

  it("shows a runtime kind's thumbnail in the grid, and the icon otherwise", async () => {
    const asked: string[] = [];
    setup({
      thumbnailUrl: (item) => {
        asked.push(item.title);
        return PIXEL;
      },
    });
    await screen.findByRole("link", { name: "Landing page" });
    await userEvent.click(screen.getByRole("button", { name: "Grid" }));
    await waitFor(() => expect(thumbnailOf("Landing page")).toBe("image"));
    // Markdown's `thumbnail` is `none`: the icon, and its URL never asked.
    expect(thumbnailOf("Trip plan")).toBe("icon");
    expect(asked).not.toContain("Trip plan");
  });

  it("falls back to the kind's icon when the thumbnail doesn't load", async () => {
    setup({ thumbnailUrl: () => BROKEN_IMAGE });
    await screen.findByRole("link", { name: "Landing page" });
    await userEvent.click(screen.getByRole("button", { name: "Grid" }));
    await waitFor(() => expect(thumbnailOf("Landing page")).toBe("icon"));
  });

  it("offers Delete and Go to chat only where they apply", async () => {
    setup();
    await screen.findByRole("link", { name: "Release notes" });
    await userEvent.click(
      screen.getByRole("button", { name: "Actions for Release notes" })
    );
    expect(
      await screen.findByRole("menuitem", { name: "Use in chat" })
    ).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Delete" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Go to chat" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Rename" })).toBeNull();
    await userEvent.keyboard("{Escape}");

    await userEvent.click(
      screen.getByRole("button", { name: "Actions for Trip plan" })
    );
    expect(
      await screen.findByRole("menuitem", { name: "Delete" })
    ).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Go to chat" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Rename" })).toBeTruthy();
  });
});
