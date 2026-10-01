import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type { MenuItemConstructorOptions } from "electron";

import type { Platform } from "../shared/ipc";

// The native menu. Standard roles give the system's own labels and
// accelerators (copy and paste need the Edit menu on macOS). 117 replaces
// this with menus generated from the shortcut registry.

export interface MenuActions {
  readonly changeInstance: () => void;
}

export const menuTemplate = ({
  actions,
  appName,
  i18n,
  platform,
}: {
  readonly actions: MenuActions;
  readonly appName: string;
  readonly i18n: I18n;
  readonly platform: Platform;
}): MenuItemConstructorOptions[] => {
  const changeInstance: MenuItemConstructorOptions = {
    click: actions.changeInstance,
    id: "change-instance",
    label: i18n._(msg`Change Server…`),
  };
  const view: MenuItemConstructorOptions = {
    role: "viewMenu",
    submenu: [
      { role: "reload" },
      { role: "forceReload" },
      { role: "toggleDevTools" },
      { type: "separator" },
      { role: "resetZoom" },
      { role: "zoomIn" },
      { role: "zoomOut" },
      { type: "separator" },
      { role: "togglefullscreen" },
    ],
  };
  if (platform === "mac") {
    return [
      {
        label: appName,
        submenu: [
          { role: "about" },
          { type: "separator" },
          changeInstance,
          { type: "separator" },
          { role: "services" },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          { role: "quit" },
        ],
      },
      { role: "editMenu" },
      view,
      { role: "windowMenu" },
    ];
  }
  return [
    {
      role: "fileMenu",
      submenu: [changeInstance, { type: "separator" }, { role: "quit" }],
    },
    { role: "editMenu" },
    view,
    { role: "windowMenu" },
  ];
};
