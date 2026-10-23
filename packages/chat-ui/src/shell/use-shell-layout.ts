"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  clampPanelWidth,
  clampSidebarWidth,
  defaultShellLayout,
  parseShellLayout,
  parseSidebarWidth,
  type ShellLayout,
  SIDEBAR_WIDTH_STORAGE_KEY,
  SIDEBAR_WIDTH_VAR,
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

  // With no room to dock the sidebar, the shell claims the toggle and shows
  // it over the page instead, so ⌘B, the palette and the buttons agree.
  const claimed = useRef<(() => void) | null>(null);
  const toggleSidebar = useCallback(() => {
    const claim = claimed.current;
    if (claim !== null) {
      claim();
      return;
    }
    setLayout((current) => ({
      ...current,
      sidebarOpen: !current.sidebarOpen,
    }));
  }, []);
  const claimSidebarToggle = useCallback((toggle: (() => void) | null) => {
    claimed.current = toggle;
  }, []);
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

  return {
    claimSidebarToggle,
    layout,
    setPanel,
    setPanelWidth,
    togglePanel,
    toggleSidebar,
  };
};

export type ShellLayoutState = ReturnType<typeof useShellLayout>;

/**
 * The sidebar's saved width (071). `null` until it's been read after mount,
 * so server and client HTML agree; until then the shell sizes the sidebar
 * from the `SIDEBAR_WIDTH_VAR` the app's pre-paint script set on `<html>`.
 * Saving writes that variable too, so a shell mounted later (another page)
 * starts at the new width rather than the one the page loaded with.
 */
export const useSidebarWidth = (storageKey = SIDEBAR_WIDTH_STORAGE_KEY) => {
  const [width, setWidth] = useState<number | null>(null);

  const apply = useCallback((next: number) => {
    setWidth(next);
    document.documentElement.style.setProperty(SIDEBAR_WIDTH_VAR, `${next}px`);
  }, []);

  useEffect(() => {
    apply(parseSidebarWidth(readStored(storageKey)));
  }, [apply, storageKey]);

  const save = useCallback(
    (next: number) => {
      const clamped = clampSidebarWidth(next);
      apply(clamped);
      writeStored(storageKey, String(clamped));
    },
    [apply, storageKey]
  );

  return { save, width };
};
