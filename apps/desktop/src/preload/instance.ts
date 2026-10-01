import { contextBridge, type IpcRendererEvent, ipcRenderer } from "electron";

import {
  channels,
  type MenuCommand,
  menuCommandSchema,
  platformOf,
} from "../shared/ipc";

// The instance's pages are remote content, so this bridge is deliberately
// tiny (D24): which platform the shell runs on, the menu's commands
// (shortcut ids), and hiding the Quick AI window (118), which main does only
// when the Quick AI window's own page asks. It reaches nothing on this
// machine. The web app reads it through `@workspace/shortcuts/desktop`
// (117): the platform lays out the title bar, and each command runs that
// shortcut's handler.

const bridge = {
  /** Hides the Quick AI window, if this page is in it (Escape on `/quick`). */
  hideQuickAi(): void {
    ipcRenderer.send(channels.quickHide);
  },
  /** Subscribes to native menu commands (shortcut ids); returns the unsubscribe. */
  onMenuCommand(listener: (command: MenuCommand) => void): () => void {
    const handler = (_event: IpcRendererEvent, payload: unknown) => {
      const command = menuCommandSchema.safeParse(payload);
      if (command.success) {
        listener(command.data);
      }
    };
    ipcRenderer.on(channels.menuCommand, handler);
    return () => {
      ipcRenderer.removeListener(channels.menuCommand, handler);
    };
  },
  platform: platformOf(process.platform),
} as const;

export type InstanceBridge = typeof bridge;

contextBridge.exposeInMainWorld("desktop", bridge);
