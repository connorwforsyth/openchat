import { createI18n } from "@workspace/i18n/catalog";
import {
  getShortcut,
  type ShortcutId,
  shortcutIdSchema,
} from "@workspace/shortcuts/registry";
import type { MenuItemConstructorOptions } from "electron";
import { describe, expect, it, vi } from "vitest";

import type { Platform } from "../shared/ipc";
import {
  type MenuActions,
  menuTemplate,
  OFF_MENU,
  trayMenuTemplate,
} from "./menu";
import { parseQuickShortcut, type QuickShortcut } from "./quick-shortcut";

const i18n = createI18n("en");
const altSpace = parseQuickShortcut("Alt+Space");

const build = (
  platform: Platform,
  actions: Partial<MenuActions> = {},
  quickShortcut: QuickShortcut = altSpace
) =>
  menuTemplate({
    actions: {
      changeInstance: vi.fn(),
      runShortcut: vi.fn(),
      setQuickShortcut: vi.fn(),
      toggleQuick: vi.fn(),
      ...actions,
    },
    appName: "Shell",
    i18n,
    platform,
    quickShortcut,
  });

const submenu = (item: MenuItemConstructorOptions | undefined) =>
  Array.isArray(item?.submenu) ? item.submenu : [];

/** Every item in the template, menus and their items, depth first. */
const flatten = (
  items: readonly MenuItemConstructorOptions[]
): MenuItemConstructorOptions[] =>
  items.flatMap((item) => [item, ...flatten(submenu(item))]);

const findItem = (
  items: readonly MenuItemConstructorOptions[],
  id: string
): MenuItemConstructorOptions | undefined =>
  flatten(items).find((item) => item.id === id);

/** Clicks an item the way the menu would, minus Electron's arguments. */
const click = (item: MenuItemConstructorOptions | undefined) => {
  const handler = item?.click as (() => void) | undefined;
  handler?.();
};

describe("menuTemplate", () => {
  it("puts Settings and Change Server in the app menu on macOS", () => {
    const [appMenu, ...rest] = build("mac");
    expect(appMenu?.label).toBe("Shell");
    const ids = submenu(appMenu).map((entry) => entry.id);
    expect(ids).toContain("settings.open");
    expect(ids).toContain("change-instance");
    expect(rest.map((menu) => menu.role ?? menu.id)).toEqual([
      "fileMenu",
      "editMenu",
      "viewMenu",
      "chat-menu",
      "windowMenu",
      "help",
    ]);
  });

  it("puts them in the File menu elsewhere", () => {
    const [file] = build("win");
    expect(file?.role).toBe("fileMenu");
    expect(submenu(file).map((entry) => entry.id ?? entry.role)).toEqual([
      "chat.new",
      "quick-ai",
      "quick-shortcut",
      undefined,
      "settings.open",
      "change-instance",
      undefined,
      "quit",
    ]);
  });

  it("calls Change Server", () => {
    const changeInstance = vi.fn();
    const item = findItem(build("mac", { changeInstance }), "change-instance");
    expect(item?.label).toBe("Change Server…");
    click(item);
    expect(changeInstance).toHaveBeenCalledOnce();
  });

  it.each(["mac", "win", "linux"] as const)(
    "offers every registry shortcut on %s, or says why not",
    (platform) => {
      const ids = new Set(flatten(build(platform)).map((item) => item.id));
      for (const id of shortcutIdSchema.options) {
        expect(
          ids.has(id) !== OFF_MENU.has(id),
          `${id}: in a menu or in OFF_MENU, not both`
        ).toBe(true);
      }
    }
  );

  it("labels items with the registry's descriptions and keys", () => {
    const menu = build("mac");
    const palette = findItem(menu, "palette.open");
    expect(palette?.label).toBe("Open the command palette");
    expect(palette?.accelerator).toBe("CommandOrControl+K");
    expect(findItem(menu, "sidebar.toggle")?.accelerator).toBe(
      "CommandOrControl+B"
    );
    expect(findItem(menu, "settings.open")?.accelerator).toBe(
      "CommandOrControl+,"
    );
    expect(findItem(menu, "model.switch")?.accelerator).toBe(
      "CommandOrControl+."
    );
    expect(findItem(menu, "help")?.label).toBe(
      i18n._(getShortcut("help").description)
    );
  });

  it("gives single-key shortcuts no accelerator", () => {
    const menu = build("mac");
    for (const id of ["chat.new", "chat.next", "composer.focus", "help"]) {
      const item = findItem(menu, id);
      expect(item).toBeDefined();
      expect(item).not.toHaveProperty("accelerator");
    }
  });

  it("sends the shortcut's id when an item is clicked", () => {
    const runShortcut = vi.fn<(id: ShortcutId) => void>();
    const menu = build("mac", { runShortcut });
    for (const id of ["chat.new", "palette.open", "sidebar.toggle"]) {
      click(findItem(menu, id));
    }
    expect(runShortcut.mock.calls).toEqual([
      ["chat.new"],
      ["palette.open"],
      ["sidebar.toggle"],
    ]);
  });

  it("opens Quick AI from the app menu, showing its global shortcut", () => {
    const toggleQuick = vi.fn();
    const [appMenu] = build("mac", { toggleQuick });
    const item = submenu(appMenu).find((entry) => entry.id === "quick-ai");
    expect(item).toMatchObject({
      accelerator: "Alt+Space",
      label: "Quick AI",
      // The global shortcut is main's; the menu only shows it.
      registerAccelerator: false,
    });
    click(item);
    expect(toggleQuick).toHaveBeenCalledOnce();
  });

  it("shows no accelerator for Quick AI without a shortcut", () => {
    const item = findItem(
      build("mac", {}, parseQuickShortcut(null)),
      "quick-ai"
    );
    expect(item).not.toHaveProperty("accelerator");
  });

  it("offers the shortcut presets, the current one checked", () => {
    const setQuickShortcut = vi.fn();
    const menu = build("mac", { setQuickShortcut });
    const choices = submenu(findItem(menu, "quick-shortcut")).filter(
      (entry) => entry.type === "radio"
    );
    expect(choices.map((entry) => [entry.label, entry.checked])).toEqual([
      ["⌥Space", true],
      ["⌃Space", false],
      ["⌘⌥Space", false],
      ["⌘⇧Space", false],
      ["No Shortcut", false],
    ]);
    click(findItem(menu, "quick-shortcut:Mod+Shift+Space"));
    click(findItem(menu, "quick-shortcut:off"));
    expect(setQuickShortcut.mock.calls).toEqual([["Mod+Shift+Space"], [null]]);
  });

  it("adds a shortcut from the settings file to the choices", () => {
    const custom = parseQuickShortcut("Ctrl+Alt+K");
    const choices = submenu(
      findItem(build("win", {}, custom), "quick-shortcut")
    );
    expect(
      choices.filter((entry) => entry.checked).map((entry) => entry.label)
    ).toEqual(["Ctrl+Alt+K"]);
  });

  it("checks No Shortcut when the setting can't be used", () => {
    const invalid = parseQuickShortcut("Hyper+Q");
    expect(findItem(build("mac", {}, invalid), "quick-shortcut:off")).toEqual(
      expect.objectContaining({ checked: true })
    );
  });
});

describe("trayMenuTemplate", () => {
  it("offers New chat, Quick AI, Show Window and Quit", () => {
    const actions = {
      newChat: vi.fn(),
      quit: vi.fn(),
      showWindow: vi.fn(),
      toggleQuick: vi.fn(),
    };
    const menu = trayMenuTemplate({ actions, i18n, quickShortcut: altSpace });
    expect(menu.map((item) => item.label ?? item.type)).toEqual([
      "New chat",
      "Quick AI",
      "Show Window",
      "separator",
      "Quit",
    ]);
    for (const item of menu) {
      click(item);
    }
    for (const action of Object.values(actions)) {
      expect(action).toHaveBeenCalledOnce();
    }
  });
});
