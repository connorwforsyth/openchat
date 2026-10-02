import { setupI18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { type KeyboardEvent, useCallback, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";

import { deepActiveElement } from "../workspace/model/focus";
import { ClosePanelButton, RightPanel } from "./right-panel";

// The right panel's frame (070): opening moves focus in, Escape closes one
// layer at a time, and closing hands focus back to what opened it.

const i18n = setupI18n({ locale: "en", messages: { en: {} } });

/** A header toggle and the panel it opens, like `ChatScreen`'s. */
function Shell({ withComposer = false }: { readonly withComposer?: boolean }) {
  const [open, setOpen] = useState(false);
  const toggleOpen = useCallback(() => setOpen((was) => !was), []);
  const close = useCallback(() => setOpen(false), []);
  // The agent opening the panel while someone types.
  const openFromComposer = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        setOpen(true);
      }
    },
    []
  );
  return (
    <I18nProvider i18n={i18n}>
      <header data-slot="app-header">
        <button
          aria-label="Files"
          aria-pressed={open}
          onClick={toggleOpen}
          type="button"
        >
          toggle
        </button>
      </header>
      {withComposer ? (
        <textarea aria-label="Message" onKeyDown={openFromComposer} />
      ) : null}
      {open ? (
        <RightPanel onClose={close}>
          <button type="button">Inside</button>
          <input aria-label="Address" />
          <ClosePanelButton />
        </RightPanel>
      ) : null}
    </I18nProvider>
  );
}

const frame = () => document.querySelector('[data-slot="right-panel"]');
const toggle = () => screen.getByRole("button", { name: "Files" });

afterEach(cleanup);

describe("RightPanel", () => {
  it("takes focus when it opens, and Escape closes it, back to the toggle", async () => {
    render(<Shell />);
    await userEvent.click(toggle());
    expect(deepActiveElement(document)).toBe(frame());

    await userEvent.keyboard("{Escape}");
    expect(frame()).toBeNull();
    expect(document.activeElement).toBe(toggle());
  });

  it("leaves a field on the first Escape and closes on the second", async () => {
    render(<Shell />);
    await userEvent.click(toggle());
    await userEvent.click(screen.getByRole("textbox", { name: "Address" }));
    await userEvent.keyboard("{Escape}");
    expect(frame()).not.toBeNull();
    expect(document.activeElement).toBe(frame());
    await userEvent.keyboard("{Escape}");
    expect(frame()).toBeNull();
  });

  it("hands focus back from Close too", async () => {
    render(<Shell />);
    await userEvent.click(toggle());
    await userEvent.click(screen.getByRole("button", { name: "Close panel" }));
    expect(frame()).toBeNull();
    expect(document.activeElement).toBe(toggle());
  });

  it("goes back to the toggle when it was opened from nowhere (S)", async () => {
    render(<Shell />);
    // Opened by a key with nothing focused: focus is on the page.
    (document.activeElement as HTMLElement | null)?.blur();
    toggle().click();
    await waitFor(() => expect(frame()).not.toBeNull());
    // Focus was on <body> when the panel opened.
    screen.getByRole("button", { name: "Inside" }).focus();
    await userEvent.keyboard("{Escape}");
    expect(document.activeElement).toBe(toggle());
  });

  it("doesn't take focus from someone typing (the panel opening by itself)", async () => {
    render(<Shell withComposer />);
    const composer = screen.getByRole("textbox", { name: "Message" });
    await userEvent.click(composer);
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(frame()).not.toBeNull());
    expect(document.activeElement).toBe(composer);
  });

  it("has no title bar of its own: the content's header has Close", async () => {
    render(<Shell />);
    await userEvent.click(toggle());
    expect(screen.queryByRole("heading", { name: "Workspace" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Close panel" })).toHaveLength(
      1
    );
  });
});
