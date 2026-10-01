import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { electronAccelerator } from "@workspace/shortcuts/electron";
import { getShortcut, type ShortcutId } from "@workspace/shortcuts/registry";
import type { MenuItemConstructorOptions } from "electron";

import type { Platform } from "../shared/ipc";
import {
  QUICK_SHORTCUT_PRESETS,
  type QuickShortcut,
  type QuickShortcutSetting,
  shortcutLabel,
} from "./quick-shortcut";

// The native menus (117, D14): the app's own items come from the shortcut
// registry, so their labels are the registry's descriptions and their
// accelerators its keys. A click sends the shortcut's id to the page, which
// runs it as if the keys were pressed. Standard roles give the system's own
// labels and accelerators for the rest (copy and paste need the Edit menu on
// macOS).
//
// The page sees a key press before the menu does and claims the ones it
// handles, so a shortcut doesn't run twice; the menu's accelerator only
// fires when the page left the keys alone (focus in an artifact frame, say).
// Single-key shortcuts (N, J, /) get no accelerator: one would fire while
// typing. Their items still work by click.

export interface MenuActions {
  readonly changeInstance: () => void;
  /** Sends a shortcut's command to the instance's page. */
  readonly runShortcut: (id: ShortcutId) => void;
  /** Saves and registers another Quick AI shortcut, or none (118). */
  readonly setQuickShortcut: (setting: QuickShortcutSetting) => void;
  /** Shows or hides the Quick AI window (118). */
  readonly toggleQuick: () => void;
}

/**
 * The Quick AI items (118): the window itself, showing its global shortcut,
 * and a choice of shortcut. The settings file can name one the menu doesn't
 * offer; it shows as checked alongside the presets.
 */
const quickItems = ({
  actions,
  i18n,
  platform,
  quickShortcut,
}: {
  readonly actions: MenuActions;
  readonly i18n: I18n;
  readonly platform: Platform;
  readonly quickShortcut: QuickShortcut;
}): MenuItemConstructorOptions[] => {
  const current = quickShortcut.kind === "on" ? quickShortcut.combo : null;
  const combos =
    current && !QUICK_SHORTCUT_PRESETS.includes(current)
      ? [...QUICK_SHORTCUT_PRESETS, current]
      : QUICK_SHORTCUT_PRESETS;
  return [
    {
      ...(quickShortcut.kind === "on"
        ? {
            accelerator: quickShortcut.accelerator,
            // Shown for the person; main registers it as a global shortcut.
            registerAccelerator: false,
          }
        : {}),
      click: actions.toggleQuick,
      id: "quick-ai",
      label: i18n._(msg`Quick AI`),
    },
    {
      id: "quick-shortcut",
      label: i18n._(msg`Quick AI Shortcut`),
      submenu: [
        ...combos.map(
          (combo): MenuItemConstructorOptions => ({
            checked: combo === current,
            click: () => actions.setQuickShortcut(combo),
            id: `quick-shortcut:${combo}`,
            label: shortcutLabel(combo, platform),
            type: "radio",
          })
        ),
        { type: "separator" },
        {
          checked: quickShortcut.kind !== "on",
          click: () => actions.setQuickShortcut(null),
          id: "quick-shortcut:off",
          label: i18n._(msg`No Shortcut`),
          type: "radio",
        },
      ],
    },
  ];
};

export interface TrayActions {
  readonly newChat: () => void;
  readonly quit: () => void;
  readonly showWindow: () => void;
  readonly toggleQuick: () => void;
}

/** The menu bar icon's menu (117, 118): New chat, Quick AI, Show window, Quit. */
export const trayMenuTemplate = ({
  actions,
  i18n,
  quickShortcut,
}: {
  readonly actions: TrayActions;
  readonly i18n: I18n;
  readonly quickShortcut: QuickShortcut;
}): MenuItemConstructorOptions[] => [
  {
    click: actions.newChat,
    id: "tray:new-chat",
    label: i18n._(getShortcut("chat.new").description),
  },
  {
    ...(quickShortcut.kind === "on"
      ? { accelerator: quickShortcut.accelerator, registerAccelerator: false }
      : {}),
    click: actions.toggleQuick,
    id: "tray:quick-ai",
    label: i18n._(msg`Quick AI`),
  },
  {
    click: actions.showWindow,
    id: "tray:show-window",
    label: i18n._(msg`Show Window`),
  },
  { type: "separator" },
  { click: actions.quit, id: "tray:quit", label: i18n._(msg`Quit`) },
];

/**
 * Registry shortcuts with no menu item, and why. Every other id has one (a
 * test checks), so a new shortcut lands in a menu or here.
 */
export const OFF_MENU: ReadonlyMap<ShortcutId, string> = new Map([
  // The web app doesn't bind these yet; an item would do nothing.
  ["reply.copy", "not bound in the web app yet"],
  ["run.stop", "not bound in the web app yet"],
]);

export const menuTemplate = ({
  actions,
  appName,
  i18n,
  platform,
  quickShortcut,
}: {
  readonly actions: MenuActions;
  readonly appName: string;
  readonly i18n: I18n;
  readonly platform: Platform;
  readonly quickShortcut: QuickShortcut;
}): MenuItemConstructorOptions[] => {
  const shortcut = (id: ShortcutId): MenuItemConstructorOptions => {
    const accelerator = electronAccelerator(id);
    return {
      ...(accelerator ? { accelerator } : {}),
      click: () => actions.runShortcut(id),
      id,
      label: i18n._(getShortcut(id).description),
    };
  };
  const separator: MenuItemConstructorOptions = { type: "separator" };
  const changeInstance: MenuItemConstructorOptions = {
    click: actions.changeInstance,
    id: "change-instance",
    label: i18n._(msg`Change Server…`),
  };
  const mac = platform === "mac";
  const quick = quickItems({ actions, i18n, platform, quickShortcut });

  const file: MenuItemConstructorOptions = {
    role: "fileMenu",
    submenu: mac
      ? [shortcut("chat.new"), separator, { role: "close" }]
      : [
          shortcut("chat.new"),
          ...quick,
          separator,
          shortcut("settings.open"),
          changeInstance,
          separator,
          { role: "quit" },
        ],
  };
  const view: MenuItemConstructorOptions = {
    role: "viewMenu",
    submenu: [
      shortcut("palette.open"),
      shortcut("sidebar.toggle"),
      separator,
      shortcut("panel.sandbox"),
      shortcut("panel.artifacts"),
      separator,
      { role: "reload" },
      { role: "forceReload" },
      { role: "toggleDevTools" },
      separator,
      { role: "resetZoom" },
      { role: "zoomIn" },
      { role: "zoomOut" },
      separator,
      { role: "togglefullscreen" },
    ],
  };
  const chat: MenuItemConstructorOptions = {
    id: "chat-menu",
    label: i18n._(msg`Chat`),
    submenu: [
      shortcut("model.switch"),
      shortcut("composer.focus"),
      separator,
      shortcut("branch.prev"),
      shortcut("branch.next"),
      separator,
      shortcut("chat.prev"),
      shortcut("chat.next"),
    ],
  };
  const help: MenuItemConstructorOptions = {
    role: "help",
    submenu: [shortcut("help")],
  };
  const shared: MenuItemConstructorOptions[] = [
    file,
    { role: "editMenu" },
    view,
    chat,
    { role: "windowMenu" },
    help,
  ];

  if (!mac) {
    return shared;
  }
  return [
    {
      label: appName,
      submenu: [
        { role: "about" },
        separator,
        shortcut("settings.open"),
        changeInstance,
        separator,
        ...quick,
        separator,
        { role: "services" },
        separator,
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        separator,
        { role: "quit" },
      ],
    },
    ...shared,
  ];
};
