import { setupI18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { fixtureId } from "@workspace/contract/fixtures";
import type { Connector } from "@workspace/contract/schemas/library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import type { ComposerMcp } from "../props";
import { Composer } from "./composer";

// The composer's mcp (188): the + menu's per-chat switches and the
// "differs from your defaults" chip, and `/` finding a server by name.

const i18n = setupI18n({ locale: "en", messages: { en: {} } });

const base: Connector = {
  auth: "none",
  availability: { state: "available" },
  customized: false,
  description: null,
  disabledTools: [],
  enabled: true,
  id: fixtureId("libraryItem", 70),
  lock: null,
  name: "docs",
  requiredTools: [],
  source: "instance",
  title: "Company docs",
  transport: "http",
};
const audit: Connector = {
  ...base,
  id: fixtureId("libraryItem", 71),
  lock: { reason: "Required by IT", type: "required" },
  name: "audit",
  title: "Audit log",
};
const desktop: Connector = {
  ...base,
  availability: { state: "desktop_only" },
  id: fixtureId("libraryItem", 72),
  name: "files",
  title: "Local files",
};

const SEARCH = /^search/;
const DOCS = /^Company docs/;
const MCP = /^MCP servers/;
const PLUGINS = /^Plugins/;
const LOCAL_FILES = /Local files/;
const AUDIT = /^Audit log/;
const DIFFERS = /MCP servers differ/;
const TURN_OFF_DOCS = /Turn off Company docs/;

const renderWith = (overrides: Partial<ComposerMcp> = {}) => {
  const mcp: ComposerMcp = {
    customized: false,
    onReset: vi.fn(),
    onToggle: vi.fn(),
    servers: [base, audit, desktop],
    term: { label: "MCP servers", singular: "MCP server" },
    ...overrides,
  };
  render(
    <I18nProvider i18n={i18n}>
      <Composer mcp={mcp} onSubmit={vi.fn()} />
    </I18nProvider>
  );
  return mcp;
};

const openMcp = async () => {
  await userEvent.click(screen.getByRole("button", { name: "Add to message" }));
  await userEvent.click(await screen.findByRole("menuitem", { name: MCP }));
};

afterEach(() => {
  cleanup();
});

describe("composer mcp (188)", () => {
  it("lists this chat's servers as switches, two levels deep", async () => {
    const mcp = renderWith();
    await openMcp();
    const docs = await screen.findByRole("menuitemcheckbox", { name: DOCS });
    expect(docs.getAttribute("aria-checked")).toBe("true");
    // Desktop-only servers can't run here: not offered.
    expect(
      screen.queryByRole("menuitemcheckbox", { name: LOCAL_FILES })
    ).toBeNull();
    // No third level: tools are a settings matter.
    expect(screen.queryByRole("menuitemcheckbox", { name: SEARCH })).toBeNull();
    await userEvent.click(docs);
    expect(mcp.onToggle).toHaveBeenLastCalledWith(base.id, false);
  });

  it("locks a required server's switch", async () => {
    renderWith();
    await openMcp();
    const locked = await screen.findByRole("menuitemcheckbox", { name: AUDIT });
    expect(locked.getAttribute("aria-disabled")).toBe("true");
  });

  it("shows when the chat differs from the defaults, and resets from the chip or the menu", async () => {
    const mcp = renderWith({
      customized: true,
      servers: [{ ...base, customized: true, enabled: false }],
    });
    const chip = screen.getByRole("button", {
      name: "MCP servers differ from your defaults in this chat. Reset them",
    });
    await userEvent.click(chip);
    expect(mcp.onReset).toHaveBeenCalledOnce();

    await userEvent.click(
      screen.getByRole("button", { name: "Add to message" })
    );
    await userEvent.click(await screen.findByRole("menuitem", { name: MCP }));
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Reset to my defaults" })
    );
    expect(mcp.onReset).toHaveBeenCalledTimes(2);
  });

  it("offers no reset, and no chip, while the chat follows the defaults", async () => {
    renderWith();
    expect(screen.queryByRole("button", { name: DIFFERS })).toBeNull();
    await userEvent.click(
      screen.getByRole("button", { name: "Add to message" })
    );
    await userEvent.click(await screen.findByRole("menuitem", { name: MCP }));
    const reset = await screen.findByRole("menuitem", {
      name: "Reset to my defaults",
    });
    expect(reset.getAttribute("aria-disabled")).toBe("true");
  });

  it("switches a server for this chat from /", async () => {
    const mcp = renderWith();
    const editor = screen.getByRole("textbox", { name: "Message" });
    await userEvent.click(editor);
    await userEvent.keyboard("/doc");
    await screen.findByRole("group", { name: "MCP servers" });
    expect(screen.getByRole("option", { name: TURN_OFF_DOCS })).toBeTruthy();
    await userEvent.keyboard("{Enter}");
    expect(mcp.onToggle).toHaveBeenLastCalledWith(base.id, false);
    await waitFor(() => expect(editor.textContent).toBe(""));
  });

  it("names the menu with the instance's own term (191)", async () => {
    renderWith({ term: { label: "Plugins", singular: "plugin" } });
    await userEvent.click(
      screen.getByRole("button", { name: "Add to message" })
    );
    expect(await screen.findByRole("menuitem", { name: PLUGINS })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: MCP })).toBeNull();
  });
});
