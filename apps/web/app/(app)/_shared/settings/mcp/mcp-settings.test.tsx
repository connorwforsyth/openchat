import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { resolveTerms } from "@workspace/config/terms";
import { fixtureId } from "@workspace/contract/fixtures";
import type {
  Connector,
  ConnectorList,
} from "@workspace/contract/schemas/library";
import { afterEach, describe, expect, it } from "vitest";
import { TermsProvider } from "@/app/(app)/_shared/terms";
import {
  apiError,
  fakeApi,
  renderWithApi,
} from "@/app/(app)/_shared/test-harness";

import { McpSettings } from "./mcp-settings";

afterEach(() => {
  cleanup();
});

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

const docs = server({ description: "Search the handbook" });
const audit = server({
  id: fixtureId("libraryItem", 2),
  lock: { reason: "Audit trail", type: "required" },
  name: "audit",
  title: "Audit log",
});
const files = server({
  availability: { state: "desktop_only" },
  enabled: false,
  id: fixtureId("libraryItem", 3),
  name: "files",
  title: "Files",
  transport: "stdio",
});

const listOf = (connectors: Connector[], allowed = true): ConnectorList => ({
  connectors,
  customized: false,
  userServers: { allowed, hosts: [], transports: ["http", "sse"] },
});

describe("McpSettings", () => {
  it("shows operator servers, locks required ones with the reason, and saves a toggle", async () => {
    const api = fakeApi({
      "GET /connectors": () => listOf([docs, audit, files]),
      "PUT /connectors/:id/enabled": () => ({ ...docs, enabled: false }),
    });
    renderWithApi(<McpSettings />, api);

    const docsSwitch = await screen.findByRole("switch", {
      name: "Use Docs in chats",
    });
    expect(
      screen.getByRole("switch", { name: "Use Audit log in chats" })
    ).toHaveProperty("ariaDisabled", "true");
    expect(screen.getByText("Desktop app only")).toBeTruthy();
    expect(screen.getByText("Search the handbook")).toBeTruthy();

    fireEvent.click(docsSwitch);
    await waitFor(() =>
      expect(
        api.calls.find((call) => call.route.startsWith("PUT /connectors/"))
          ?.body
      ).toEqual({ enabled: false })
    );
  });

  it("opens a server's page with its tools, saves a tool switch, and locks required ones (188)", async () => {
    const api = fakeApi({
      "GET /connectors": () => listOf([docs]),
      "GET /connectors/:id/tools": () => ({
        reachable: true,
        tools: [
          {
            description: "Find pages",
            enabled: true,
            lock: null,
            name: "search",
          },
          {
            description: null,
            enabled: true,
            lock: { reason: null, type: "required" },
            name: "log_event",
          },
        ],
      }),
      "PUT /connectors/:id/tools/:tool/enabled": () => ({
        description: null,
        enabled: false,
        lock: null,
        name: "search",
      }),
    });
    renderWithApi(<McpSettings />, api);

    // Tools load only once someone opens the server.
    const disclosure = await screen.findByRole("button", {
      name: "Open Docs",
    });
    expect(api.calls.some((call) => call.route.includes("/tools"))).toBe(false);
    fireEvent.click(disclosure);
    const search = await screen.findByRole("switch", {
      name: "Use the search tool",
    });
    expect(screen.getByText("Find pages")).toBeTruthy();
    expect(
      screen.getByRole("switch", { name: "Use the log_event tool" })
    ).toHaveProperty("ariaDisabled", "true");

    fireEvent.click(search);
    await waitFor(() =>
      expect(
        api.calls.find((call) => call.route.startsWith("PUT /connectors/"))
      ).toMatchObject({ body: { enabled: false } })
    );

    // Back to the list, named with the configured term.
    fireEvent.click(screen.getByRole("button", { name: "MCP servers" }));
    expect(
      await screen.findByRole("button", { name: "Open Docs" })
    ).toBeTruthy();
  });

  it("gives the lock's reason on the server's page", async () => {
    renderWithApi(
      <McpSettings />,
      fakeApi({
        "GET /connectors": () => listOf([audit]),
        "GET /connectors/:id/tools": () => ({ reachable: true, tools: [] }),
      })
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Open Audit log" })
    );
    expect(await screen.findByText("Audit trail")).toBeTruthy();
  });

  it("says why a server's tools can't be listed", async () => {
    renderWithApi(
      <McpSettings />,
      fakeApi({
        "GET /connectors": () => listOf([docs]),
        "GET /connectors/:id/tools": () => ({ reachable: false, tools: [] }),
      })
    );
    fireEvent.click(await screen.findByRole("button", { name: "Open Docs" }));
    expect(
      await screen.findByText(
        "Couldn't reach this MCP server to list its tools."
      )
    ).toBeTruthy();
  });

  it("shows a server that needs setup as off and disabled, even when the user turned it on", async () => {
    const jira = server({
      availability: { message: "JIRA_TOKEN isn't set", state: "unconfigured" },
      enabled: true,
      id: fixtureId("libraryItem", 4),
      name: "jira",
      title: "Jira",
    });
    renderWithApi(
      <McpSettings />,
      fakeApi({ "GET /connectors": () => listOf([jira]) })
    );
    const jiraSwitch = await screen.findByRole("switch", {
      name: "Use Jira in chats",
    });
    expect(jiraSwitch).toHaveProperty("ariaChecked", "false");
    expect(jiraSwitch).toHaveProperty("ariaDisabled", "true");
    expect(screen.getByText("Needs setup by your administrator")).toBeTruthy();
  });

  it("offers Add your own when the instance allows it", async () => {
    renderWithApi(
      <McpSettings />,
      fakeApi({ "GET /connectors": () => listOf([docs]) })
    );
    expect(
      await screen.findByRole("link", { name: "Add your own" })
    ).toBeTruthy();
  });

  it("explains when there is nothing and adding is off", async () => {
    renderWithApi(
      <McpSettings />,
      fakeApi({ "GET /connectors": () => listOf([], false) })
    );
    expect(await screen.findByText("No MCP servers yet")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Add your own" })).toBeNull();
  });

  it("says what this instance calls them (191)", async () => {
    const plugins = resolveTerms({
      mcp: {
        label: "plugins",
        locales: {},
        singular: "plugin",
        slug: "plugins",
      },
    });
    renderWithApi(
      <TermsProvider terms={plugins}>
        <McpSettings />
      </TermsProvider>,
      fakeApi({ "GET /connectors": () => listOf([], false) })
    );
    expect(await screen.findByText("No plugins yet")).toBeTruthy();
    expect(screen.queryByText("No MCP servers yet")).toBeNull();
  });

  it("shows Connect for an OAuth server that isn't signed in", async () => {
    const wiki = server({ auth: "oauth", title: "Wiki" });
    renderWithApi(
      <McpSettings />,
      fakeApi({
        "GET /connectors": () => listOf([wiki]),
        "GET /mcp/:id/status": () => ({ state: "needs_auth" }),
      })
    );
    expect(await screen.findByRole("button", { name: "Connect" })).toBeTruthy();
  });

  it("shows a retry when the list fails", async () => {
    renderWithApi(
      <McpSettings />,
      fakeApi({ "GET /connectors": () => apiError("INTERNAL", 500) })
    );
    expect(
      await screen.findByRole("button", { name: "Try again" })
    ).toBeTruthy();
  });
});
