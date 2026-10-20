import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { NEW_CHAT_DRAFT_KEY } from "@workspace/composer/ports/draft-store";
import {
  browserStorage,
  createStorageDraftStore,
} from "@workspace/composer/ports/draft-store.storage";
import { resolveTerms, termsSchema } from "@workspace/config/terms";
import { fixtureId, userAda } from "@workspace/contract/fixtures";
import type {
  Connector,
  ConnectorList,
  LibraryItem,
} from "@workspace/contract/schemas/library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppFrameProvider } from "@/app/(app)/_shared/app-frame";
import { testFrame } from "@/app/(app)/_shared/frame-fixture";
import { TermsProvider } from "@/app/(app)/_shared/terms";
import { fakeApi, renderWithApi } from "@/app/(app)/_shared/test-harness";

import { CustomizeScreen } from "./customize-screen";

// Customize (193): the catalogs, an item's page, Manage and Try now.

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  usePathname: () => "/customize",
  useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const DOCS = /Docs/;
const NOTES = /Notes/;
const PLAIN = /Plain English/;

const drafts = () => createStorageDraftStore(browserStorage, userAda.id);

beforeEach(() => {
  push.mockClear();
  drafts().clear(NEW_CHAT_DRAFT_KEY);
});
afterEach(cleanup);

const server = (extra: Partial<Connector>): Connector => ({
  auth: "none",
  availability: { state: "available" },
  customized: false,
  description: null,
  disabledTools: [],
  enabled: true,
  id: fixtureId("libraryItem", 1),
  lock: null,
  name: "docs",
  requiredTools: [],
  source: "instance",
  title: "Docs",
  transport: "http",
  ...extra,
});

const docs = server({ auth: "oauth", description: "Search the handbook" });
const notes = server({
  enabled: false,
  id: fixtureId("libraryItem", 2),
  name: "notes",
  source: "library",
  title: "Notes",
});

const list: ConnectorList = {
  connectors: [docs, notes],
  customized: false,
  userServers: { allowed: true, hosts: [], transports: ["http"] },
};

const skill: LibraryItem = {
  createdAt: "2026-10-01T00:00:00.000Z",
  createdBy: userAda.id,
  description: "Writes in plain English.",
  draftVersionId: null,
  icon: "✍️",
  id: fixtureId("libraryItem", 5),
  kind: "skill",
  latestVersionId: fixtureId("libraryVersion", 1),
  latestVersionNumber: 3,
  maintainers: [],
  myAccess: "maintainer",
  name: "Plain English",
  owner: { id: userAda.id, type: "user" },
  publishedFrom: null,
  updatedAt: "2026-10-02T00:00:00.000Z",
  visibility: "private",
};

const api = () =>
  fakeApi({
    "GET /connectors": () => list,
    "GET /connectors/:id/tools": () => ({
      reachable: true,
      tools: [
        {
          description: "Find pages",
          enabled: true,
          lock: null,
          name: "search",
        },
        { description: null, enabled: true, lock: null, name: "read" },
      ],
    }),
    "GET /library": ({ search }) => ({
      items: search.get("tab") === "mine" ? [skill] : [],
      nextCursor: null,
    }),
    "PUT /connectors/:id/enabled": ({ body }) => ({
      ...docs,
      enabled: (body as { enabled: boolean }).enabled,
    }),
  });

const show = (segments: string[], terms = resolveTerms(), fake = api()) => {
  renderWithApi(
    <AppFrameProvider value={testFrame()}>
      <TermsProvider terms={terms}>
        <CustomizeScreen segments={segments} />
      </TermsProvider>
    </AppFrameProvider>,
    fake
  );
  return fake;
};

describe("Customize (193)", () => {
  it("lists the servers by source, each linking to its page, and searches", async () => {
    show(["mcp"]);
    expect(
      await screen.findByRole("heading", { level: 1, name: "MCP servers" })
    ).toBeTruthy();
    const link = await screen.findByRole("link", { name: DOCS });
    expect(link.getAttribute("href")).toBe(`/customize/mcp/${docs.id}`);
    expect(screen.getByText("From your administrator")).toBeTruthy();
    expect(screen.getByText("Yours and shared with you")).toBeTruthy();

    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "notes" },
    });
    expect(screen.queryByRole("link", { name: DOCS })).toBeNull();
    expect(screen.getByRole("link", { name: NOTES })).toBeTruthy();
  });

  it("names and addresses the servers as `terms:` says", async () => {
    const plugins = resolveTerms(
      termsSchema.parse({
        mcp: { label: "Plugins", singular: "Plugin", slug: "plugins" },
      })
    );
    show(["plugins"], plugins);
    expect(
      await screen.findByRole("heading", { level: 1, name: "Plugins" })
    ).toBeTruthy();
    expect(
      (await screen.findByRole("link", { name: DOCS })).getAttribute("href")
    ).toBe(`/customize/plugins/${docs.id}`);
  });

  it("shows a server's page: source, Manage, Try now and its information", async () => {
    show(["mcp", docs.id]);
    expect(
      await screen.findByRole("heading", { level: 1, name: "Docs" })
    ).toBeTruthy();
    expect(screen.getByText("Search the handbook")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Manage" }).getAttribute("href")
    ).toBe(`/customize/mcp/${docs.id}/manage`);
    expect(screen.getByRole("button", { name: "Try now" })).toBeTruthy();
    expect(screen.getByText("Streamable HTTP")).toBeTruthy();
    expect(screen.getByText("Each person signs in")).toBeTruthy();
    expect(await screen.findByText("2 tools")).toBeTruthy();
  });

  it("Manage shows the server's controls and saves its switch", async () => {
    const fake = show(["mcp", docs.id, "manage"]);
    const toggle = await screen.findByRole("switch", {
      name: "Use Docs in chats",
    });
    expect(
      await screen.findByRole("switch", { name: "Use the search tool" })
    ).toBeTruthy();
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(
        fake.calls.find((call) => call.route.endsWith("/enabled"))
      ).toMatchObject({ body: { enabled: false } })
    );
    fireEvent.click(screen.getByRole("button", { name: "Docs" }));
    expect(push).toHaveBeenCalledWith(`/customize/mcp/${docs.id}`);
  });

  it("Try now opens a new chat with the server on and a prompt waiting, unsent", async () => {
    const fake = show(["mcp", docs.id]);
    fireEvent.click(await screen.findByRole("button", { name: "Try now" }));
    expect(push).toHaveBeenCalledWith(`/?mcp=${docs.id}`);
    const draft = drafts().load(NEW_CHAT_DRAFT_KEY);
    expect(JSON.stringify(draft)).toContain(
      "What can you help me with using Docs?"
    );
    expect(fake.calls.some((call) => call.route.startsWith("POST"))).toBe(
      false
    );
  });

  it("lists skills, and Try now picks the skill for a new chat", async () => {
    show(["skills"]);
    const link = await screen.findByRole("link", { name: PLAIN });
    expect(link.getAttribute("href")).toBe(`/customize/skills/${skill.id}`);
    cleanup();

    show(["skills", skill.id]);
    expect(
      await screen.findByRole("heading", { level: 1, name: "Plain English" })
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Manage" }).getAttribute("href")
    ).toBe(`/library/${skill.id}`);
    fireEvent.click(screen.getByRole("button", { name: "Try now" }));
    expect(push).toHaveBeenCalledWith("/");
    const loaded = drafts().load(NEW_CHAT_DRAFT_KEY);
    expect(loaded.ok && loaded.value?.skills).toEqual([
      { id: skill.id, name: "Plain English" },
    ]);
  });

  it("says when an item isn't there", async () => {
    show(["mcp", fixtureId("libraryItem", 9)]);
    expect(await screen.findByText("Not found")).toBeTruthy();
  });
});
