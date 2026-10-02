import { setupI18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import { createMemoryOverridesStore } from "../ports/overrides-store.memory";
import { ShortcutsProvider } from "./context";
import { ShortcutsHelpDialog } from "./help-dialog";
import { ShortcutKbd } from "./shortcut-kbd";
import { ShortcutsEditor } from "./shortcuts-editor";
import { useShortcut } from "./use-shortcut";

const i18n = setupI18n({ locale: "en", messages: { en: {} } });

const Bound = ({
  onNew,
  onPalette,
}: {
  readonly onNew: () => void;
  readonly onPalette: () => void;
}) => {
  useShortcut("chat.new", onNew);
  useShortcut("palette.open", onPalette);
  return (
    <div>
      <input aria-label="Title" />
      <ShortcutKbd id="palette.open" />
    </div>
  );
};

const wrap = (
  children: ReactNode,
  store = createMemoryOverridesStore(),
  platform: "mac" | "windows" = "mac"
) =>
  render(
    <I18nProvider i18n={i18n}>
      <ShortcutsProvider platform={platform} store={store}>
        {children}
      </ShortcutsProvider>
    </I18nProvider>
  );

afterEach(() => {
  cleanup();
});

describe("useShortcut", () => {
  it("fires single keys outside text fields only", async () => {
    const onNew = vi.fn();
    wrap(<Bound onNew={onNew} onPalette={vi.fn()} />);
    await userEvent.keyboard("n");
    expect(onNew).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("textbox", { name: "Title" }));
    await userEvent.keyboard("n");
    expect(onNew).toHaveBeenCalledTimes(1);
    expect(
      (screen.getByRole("textbox", { name: "Title" }) as HTMLInputElement).value
    ).toBe("n");
  });

  it("fires ⌘ combos even while typing", async () => {
    const onPalette = vi.fn();
    wrap(<Bound onNew={vi.fn()} onPalette={onPalette} />);
    await userEvent.click(screen.getByRole("textbox", { name: "Title" }));
    await userEvent.keyboard("{Meta>}k{/Meta}");
    expect(onPalette).toHaveBeenCalledTimes(1);
  });

  it("follows recorded overrides from the store", async () => {
    const onNew = vi.fn();
    const store = createMemoryOverridesStore({ "chat.new": ["Alt+N"] });
    wrap(<Bound onNew={onNew} onPalette={vi.fn()} />, store);
    await waitFor(async () => {
      await userEvent.keyboard("{Alt>}n{/Alt}");
      expect(onNew).toHaveBeenCalled();
    });
    onNew.mockClear();
    await userEvent.keyboard("n");
    expect(onNew).not.toHaveBeenCalled();
  });

  it("runs on the desktop shell's menu command, even while typing", async () => {
    const listeners = new Set<(command: unknown) => void>();
    Object.assign(window, {
      desktop: {
        onMenuCommand: (listener: (command: unknown) => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        platform: "mac",
      },
    });
    const send = (command: string) => {
      for (const listener of listeners) {
        listener(command);
      }
    };
    try {
      const onNew = vi.fn();
      const onPalette = vi.fn();
      const { unmount } = wrap(<Bound onNew={onNew} onPalette={onPalette} />);
      await userEvent.click(screen.getByRole("textbox", { name: "Title" }));
      send("chat.new");
      send("help");
      expect(onNew).toHaveBeenCalledTimes(1);
      expect(onPalette).not.toHaveBeenCalled();
      unmount();
      expect(listeners.size).toBe(0);
    } finally {
      Reflect.deleteProperty(window, "desktop");
    }
  });

  it("shows ⌘ or Ctrl in Kbd hints by platform", () => {
    const { unmount } = wrap(<ShortcutKbd id="palette.open" />);
    expect(document.body.textContent).toContain("⌘K");
    unmount();
    wrap(<ShortcutKbd id="palette.open" />, undefined, "windows");
    expect(document.body.textContent).toContain("CtrlK");
  });
});

describe("ShortcutsHelpDialog", () => {
  it("opens on ? and lists every shortcut", async () => {
    wrap(<ShortcutsHelpDialog />);
    await userEvent.keyboard("?");
    const dialog = await screen.findByRole("dialog", {
      name: "Keyboard shortcuts",
    });
    for (const text of [
      "Open the command palette",
      "New chat",
      "Focus the composer",
      "Previous branch",
      "Show or hide the files",
      "Toggle the sidebar",
    ]) {
      expect(dialog.textContent).toContain(text);
    }
  });
});

describe("ShortcutsEditor", () => {
  it("records, saves and resets a shortcut", async () => {
    const store = createMemoryOverridesStore();
    wrap(<ShortcutsEditor />, store);
    await userEvent.click(
      screen.getByRole("button", { name: "Record a shortcut for New chat" })
    );
    expect(screen.getByText("Press keys…")).toBeTruthy();
    await userEvent.keyboard("{Alt>}{Shift>}m{/Shift}{/Alt}");
    await waitFor(() =>
      expect(store.saves.at(-1)).toEqual({ "chat.new": ["Alt+Shift+M"] })
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Reset New chat" })
    );
    await waitFor(() => expect(store.saves.at(-1)).toEqual({}));
  });

  it("explains a clash instead of saving it", async () => {
    const store = createMemoryOverridesStore();
    wrap(<ShortcutsEditor />, store);
    await userEvent.click(
      screen.getByRole("button", { name: "Record a shortcut for New chat" })
    );
    await userEvent.keyboard("{Meta>}k{/Meta}");
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Open the command palette"
    );
    expect(store.saves).toEqual([]);
  });
});
