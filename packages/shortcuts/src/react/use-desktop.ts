"use client";

import { useSyncExternalStore } from "react";

import { type DesktopPlatform, readDesktopBridge } from "../desktop";

// Whether the page runs inside the desktop shell, and on which OS (117). The
// server and the first client render say "not in the shell", so hydration
// matches; inside the shell the client corrects it straight after. In a
// browser it never changes, so nothing there shifts.

const subscribeNever = () => () => undefined;
const fromWindow = (): DesktopPlatform | null =>
  readDesktopBridge(window)?.platform ?? null;
const onServer = (): null => null;

/** The shell's OS, or `null` in a browser. */
export const useDesktopPlatform = (): DesktopPlatform | null =>
  useSyncExternalStore(subscribeNever, fromWindow, onServer);
