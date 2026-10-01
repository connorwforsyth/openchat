import { contextBridge, ipcRenderer } from "electron";

import {
  type ConnectResult,
  type CurrentInstance,
  channels,
  connectInputSchema,
  connectResultSchema,
  currentInstanceSchema,
  platformOf,
} from "../shared/ipc";

// The first-run page's bridge: ask main to check an instance URL and connect
// to it. Only the local setup window gets this preload; main also checks the
// sender (src/main/ipc.ts). Every payload is parsed on both sides.

const bridge = {
  async connect(url: string): Promise<ConnectResult> {
    const input = connectInputSchema.parse({ url });
    return connectResultSchema.parse(
      await ipcRenderer.invoke(channels.setupConnect, input)
    );
  },
  async current(): Promise<CurrentInstance> {
    return currentInstanceSchema.parse(
      await ipcRenderer.invoke(channels.setupCurrent)
    );
  },
  platform: platformOf(process.platform),
} as const;

export type SetupBridge = typeof bridge;

contextBridge.exposeInMainWorld("desktopSetup", bridge);
