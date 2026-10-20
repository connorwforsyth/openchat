import { setupI18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { fixtureId } from "@workspace/contract/fixtures";
import type {
  Connector,
  ConnectorToolList,
} from "@workspace/contract/schemas/library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import type { ComposerConnectors } from "../props";
import { Composer } from "./composer";

// The composer's connectors (188): the + menu's per-chat switches and the
// "differs from your defaults" chip, and `/` finding a connector by name.

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
const docsTools: ConnectorToolList = {
  reachable: true,
  tools: [
    {
      description: "Search the docs",
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
};

const SEARCH = /^search/;
const LOG_EVENT = /^log_event/;
const DOCS = /^Company docs/;
const CONNECTORS = /^Connectors/;
const USE_HERE = /^Use in this chat/;
const LOCAL_FILES = /Local files/;
const AUDIT = /^Audit log/;
const DIFFERS = /Connectors differ/;
const TURN_OFF_DOCS = /Turn off Company docs/;

const renderWith = (overrides: Partial<ComposerConnectors> = {}) => {
  const connectors: ComposerConnectors = {
    connectors: [base, audit, desktop],
    customized: false,
    onReset: vi.fn(),
    onToggle: vi.fn(),
    onToggleTool: vi.fn(),
    onWantTools: vi.fn(),
    tools: { [base.id]: docsTools },
    ...overrides,
  };
  render(
    <I18nProvider i18n={i18n}>
      <Composer connectors={connectors} onSubmit={vi.fn()} />
    </I18nProvider>
  );
  return connectors;
};

const openConnector = async (name: RegExp) => {
  await userEvent.click(screen.getByRole("button", { name: "Add to message" }));
  await userEvent.click(
    await screen.findByRole("menuitem", { name: CONNECTORS })
  );
  await userEvent.click(await screen.findByRole("menuitem", { name }));
};

afterEach(() => {
  cleanup();
});

describe("composer connectors (188)", () => {
  it("lists what this chat can use, and loads tools when a connector opens", async () => {
    const connectors = renderWith();
    await openConnector(DOCS);
    await screen.findByRole("menuitemcheckbox", { name: USE_HERE });
    expect(connectors.onWantTools).toHaveBeenCalledWith(base.id);
    // Desktop-only connectors can't run here: not offered.
    expect(screen.queryByRole("menuitem", { name: LOCAL_FILES })).toBeNull();

    const search = await screen.findByRole("menuitemcheckbox", {
      name: SEARCH,
    });
    expect(search.getAttribute("aria-checked")).toBe("true");
    await userEvent.click(search);
    expect(connectors.onToggleTool).toHaveBeenLastCalledWith(
      base.id,
      "search",
      false
    );
    // The operator's required tool can't be switched off.
    const required = screen.getByRole("menuitemcheckbox", { name: LOG_EVENT });
    expect(required.getAttribute("aria-disabled")).toBe("true");

    await userEvent.click(
      screen.getByRole("menuitemcheckbox", { name: USE_HERE })
    );
    expect(connectors.onToggle).toHaveBeenLastCalledWith(base.id, false);
  });

  it("locks a required connector's switch", async () => {
    renderWith();
    await openConnector(AUDIT);
    const use = await screen.findByRole("menuitemcheckbox", { name: USE_HERE });
    expect(use.getAttribute("aria-disabled")).toBe("true");
  });

  it("shows when the chat differs from the defaults, and resets from the chip or the menu", async () => {
    const connectors = renderWith({
      connectors: [{ ...base, customized: true, enabled: false }],
      customized: true,
    });
    const chip = screen.getByRole("button", {
      name: "Connectors differ from your defaults in this chat. Reset them",
    });
    await userEvent.click(chip);
    expect(connectors.onReset).toHaveBeenCalledOnce();

    await userEvent.click(
      screen.getByRole("button", { name: "Add to message" })
    );
    await userEvent.click(
      await screen.findByRole("menuitem", { name: CONNECTORS })
    );
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Reset to my defaults" })
    );
    expect(connectors.onReset).toHaveBeenCalledTimes(2);
  });

  it("offers no reset, and no chip, while the chat follows the defaults", async () => {
    renderWith();
    expect(screen.queryByRole("button", { name: DIFFERS })).toBeNull();
    await userEvent.click(
      screen.getByRole("button", { name: "Add to message" })
    );
    await userEvent.click(
      await screen.findByRole("menuitem", { name: CONNECTORS })
    );
    const reset = await screen.findByRole("menuitem", {
      name: "Reset to my defaults",
    });
    expect(reset.getAttribute("aria-disabled")).toBe("true");
  });

  it("switches a connector for this chat from /", async () => {
    const connectors = renderWith();
    const editor = screen.getByRole("textbox", { name: "Message" });
    await userEvent.click(editor);
    await userEvent.keyboard("/doc");
    await screen.findByRole("listbox", { name: "Connectors" });
    expect(screen.getByRole("option", { name: TURN_OFF_DOCS })).toBeTruthy();
    await userEvent.keyboard("{Enter}");
    expect(connectors.onToggle).toHaveBeenLastCalledWith(base.id, false);
    await waitFor(() => expect(editor.textContent).toBe(""));
  });
});
