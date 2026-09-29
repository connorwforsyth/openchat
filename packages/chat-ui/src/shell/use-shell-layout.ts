"use client";

import { useCallback, useEffect, useState } from "react";

import {
  clampPanelWidth,
  defaultShellLayout,
  parseShellLayout,
  type ShellLayout,
  togglePanel as togglePanelIn,
  type WorkspaceSection,
} from "../model/layout";

export const SHELL_LAYOUT_STORAGE_KEY = "chat-ui:layout";

// Storage can throw (private mode, quota, a disabled policy); the layout then
// just isn't remembered.
const readStored = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const writeStored = (key: string, value: string): void => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Not remembered this time; nothing else depends on it.
  }
};

/**
 * The shell's layout state, remembered in `localStorage`. The first render
 * uses the defaults so server and client HTML agree; the stored layout is
 * applied right after mount. (D28's inline pre-paint restore is the app's
 * job, in ticket 025.)
 */
export const useShellLayout = (storageKey = SHELL_LAYOUT_STORAGE_KEY) => {
  const [layout, setLayout] = useState<ShellLayout>(defaultShellLayout);
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    setLayout(parseShellLayout(readStored(storageKey)));
    setRestored(true);
  }, [storageKey]);

  useEffect(() => {
    // Don't overwrite what's stored with the defaults before it's been read.
    if (restored) {
      writeStored(storageKey, JSON.stringify(layout));
    }
  }, [layout, restored, storageKey]);

  const toggleSidebar = useCallback(
    () =>
      setLayout((current) => ({
        ...current,
        sidebarOpen: !current.sidebarOpen,
      })),
    []
  );
  const setPanel = useCallback(
    (panel: WorkspaceSection | null) =>
      setLayout((current) => ({ ...current, panel })),
    []
  );
  const togglePanel = useCallback(
    (panel: WorkspaceSection) =>
      setLayout((current) => togglePanelIn(current, panel)),
    []
  );
  const setPanelWidth = useCallback(
    (panelWidth: number) =>
      setLayout((current) => ({
        ...current,
        panelWidth: clampPanelWidth(panelWidth),
      })),
    []
  );

  return { layout, setPanel, setPanelWidth, togglePanel, toggleSidebar };
};

export type ShellLayoutState = ReturnType<typeof useShellLayout>;
