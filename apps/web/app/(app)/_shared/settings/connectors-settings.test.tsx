import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { fixtureId } from "@workspace/contract/fixtures";
import type {
  Connector,
  ConnectorList,
} from "@workspace/contract/schemas/library";
import { afterEach, describe, expect, it } from "vitest";

import {
  apiError,
  fakeApi,
  renderWithApi,
} from "@/app/(app)/_shared/test-harness";
import { ConnectorsSettings } from "./connectors-settings";

afterEach(() => {
  cleanup();
});

const connector = (extra: Partial<Connector>): Connector => ({
  auth: "none",
  availability: { state: "available" },
  description: null,
  enabled: true,
  id: fixtureId("libraryItem", 1),
  lock: null,
  name: "docs",
  source: "instance",
  title: "Docs",
  transport: "http",
  ...extra,
});

const docs = connector({ description: "Search the handbook" });
const audit = connector({
  id: fixtureId("libraryItem", 2),
  lock: { reason: "Audit trail", type: "required" },
  name: "audit",
  title: "Audit log",
});
const files = connector({
  availability: { state: "desktop_only" },
  enabled: false,
  id: fixtureId("libraryItem", 3),
  name: "files",
  title: "Files",
  transport: "stdio",
});

const listOf = (connectors: Connector[], allowed = true): ConnectorList => ({
  connectors,
  userServers: { allowed, hosts: [], transports: ["http", "sse"] },
});

describe("ConnectorsSettings", () => {
  it("shows operator connectors, locks required ones with the reason, and saves a toggle", async () => {
    const api = fakeApi({
      "GET /connectors": () => listOf([docs, audit, files]),
      "PUT /connectors/:id/enabled": () => ({ ...docs, enabled: false }),
    });
    renderWithApi(<ConnectorsSettings />, api);

    const docsSwitch = await screen.findByRole("switch", {
      name: "Use Docs in chats",
    });
    expect(
      screen.getByRole("switch", { name: "Use Audit log in chats" })
    ).toHaveProperty("ariaDisabled", "true");
    expect(screen.getByText("Audit trail")).toBeTruthy();
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

  it("shows a connector that needs setup as off and disabled, even when the user turned it on", async () => {
    const jira = connector({
      availability: { message: "JIRA_TOKEN isn't set", state: "unconfigured" },
      enabled: true,
      id: fixtureId("libraryItem", 4),
      name: "jira",
      title: "Jira",
    });
    renderWithApi(
      <ConnectorsSettings />,
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
      <ConnectorsSettings />,
      fakeApi({ "GET /connectors": () => listOf([docs]) })
    );
    expect(
      await screen.findByRole("link", { name: "Add your own" })
    ).toBeTruthy();
  });

  it("explains when there is nothing and adding is off", async () => {
    renderWithApi(
      <ConnectorsSettings />,
      fakeApi({ "GET /connectors": () => listOf([], false) })
    );
    expect(await screen.findByText("No connectors yet")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Add your own" })).toBeNull();
  });

  it("shows Connect for an OAuth connector that isn't signed in", async () => {
    const wiki = connector({ auth: "oauth", title: "Wiki" });
    renderWithApi(
      <ConnectorsSettings />,
      fakeApi({
        "GET /connectors": () => listOf([wiki]),
        "GET /mcp/:id/status": () => ({ state: "needs_auth" }),
      })
    );
    expect(await screen.findByRole("button", { name: "Connect" })).toBeTruthy();
  });

  it("shows a retry when the list fails", async () => {
    renderWithApi(
      <ConnectorsSettings />,
      fakeApi({ "GET /connectors": () => apiError("INTERNAL", 500) })
    );
    expect(
      await screen.findByRole("button", { name: "Try again" })
    ).toBeTruthy();
  });
});
