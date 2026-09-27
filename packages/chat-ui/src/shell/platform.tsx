"use client";

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { z } from "zod";

import { isApplePlatform } from "../shortcuts/editable";

// Where the shell runs (D14): the web app, or the desktop app on macOS,
// Windows or Linux. The header reads it for window-control padding and drag
// regions; shortcut hints read it for ⌘ versus Ctrl.

export const platformSchema = z.enum(["web", "mac", "win", "linux"]);
export type Platform = z.infer<typeof platformSchema>;

interface PlatformValue {
  /** ⌘ rather than Ctrl, from the OS (desktop) or the browser (web). */
  readonly isApple: boolean;
  readonly platform: Platform;
}

const PlatformContext = createContext<PlatformValue>({
  isApple: false,
  platform: "web",
});

export function PlatformProvider({
  children,
  platform = "web",
}: {
  readonly children: ReactNode;
  readonly platform?: Platform;
}) {
  // On the web the OS is only known in the browser; start from "not Apple" so
  // the server and first client render agree, then correct after mount.
  const [browserApple, setBrowserApple] = useState(false);
  useEffect(() => {
    if (platform === "web") {
      setBrowserApple(isApplePlatform(navigator));
    }
  }, [platform]);

  const value = useMemo(
    () => ({
      isApple: platform === "mac" || (platform === "web" && browserApple),
      platform,
    }),
    [browserApple, platform]
  );
  return (
    <PlatformContext.Provider value={value}>
      {children}
    </PlatformContext.Provider>
  );
}

export const usePlatform = (): PlatformValue => useContext(PlatformContext);
