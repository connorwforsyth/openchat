"use client";

import type { Platform } from "@workspace/chat-ui/shell/platform";
import { useDesktopPlatform } from "@workspace/shortcuts/react/use-desktop";

// The app shell's chrome inside the desktop app (117). On macOS the window
// has no title bar (`hiddenInset`), so the header and the sidebar's top row
// drag the window and leave room for the traffic lights. Windows and Linux
// keep the native frame until their custom bar lands (122: macOS first), so
// the page lays out as on the web there. In a browser this is always "web".

export const useShellPlatform = (): Platform =>
  useDesktopPlatform() === "mac" ? "mac" : "web";
