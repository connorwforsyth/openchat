import type { SetupBridge } from "../preload/setup";

declare global {
  interface Window {
    /** The setup preload's bridge (src/preload/setup.ts). */
    readonly desktopSetup: SetupBridge;
  }
}
