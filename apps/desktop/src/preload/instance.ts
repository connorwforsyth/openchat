import { contextBridge, type IpcRendererEvent, ipcRenderer } from "electron";

import {
  channels,
  type MenuCommand,
  menuCommandSchema,
  platformOf,
} from "../shared/ipc";

// The instance's pages are remote content, so this bridge is deliberately
// tiny (D24): which platform the shell runs on, and the menu's commands. It
// reaches nothing on this machine. The web app reads `window.desktop` to know
// it's in the shell (117 adapts the title bar to it).

const bridge = {
  /** Subscribes to native menu commands; returns the unsubscribe. */
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
