"use client";

import {
  type SidebarLayoutSetting,
  sidebarLayoutSchema,
} from "@workspace/contract/schemas/meta";
import {
  createContext,
  useCallback,
  useContext,
  useSyncExternalStore,
} from "react";

// Which sidebar the shell shows on a wide screen, the user's choice (181).
// `rail` is the format going forward: the permanent icon rail beside a
// collapsible chat panel. `classic` is one sidebar with every page in its
// nav and the toggle in its top row, hidden entirely when collapsed (113).
// Narrow screens use the sheet either way. Switching doesn't animate (D28).

export const DEFAULT_SIDEBAR_LAYOUT: SidebarLayoutSetting = "rail";

/** Anything unknown or missing reads as the default. */
export const parseSidebarLayout = (value: unknown): SidebarLayoutSetting =>
  sidebarLayoutSchema.catch(DEFAULT_SIDEBAR_LAYOUT).parse(value);

const SidebarLayoutContext = createContext<SidebarLayoutSetting>(
  DEFAULT_SIDEBAR_LAYOUT
);

/** The app says which layout the user chose; without it, the rail. */
export const SidebarLayoutProvider = SidebarLayoutContext.Provider;

export const useSidebarLayout = (): SidebarLayoutSetting =>
  useContext(SidebarLayoutContext);

/** `storage` fires only in other tabs; this tells the tab that wrote. */
const LOCAL_CHANGE = "chat-ui:sidebar-layout";

// Storage can throw (private mode, a disabled policy); the choice then lasts
// only as long as the page.
const readStored = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

/**
 * The user's sidebar layout, remembered in this browser under `storageKey`
 * and kept in step across tabs. The server's render, and hydration, use the
 * default; the stored choice applies right after.
 */
export const useStoredSidebarLayout = (
  storageKey: string
): readonly [SidebarLayoutSetting, (next: SidebarLayoutSetting) => void] => {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const onStorage = (event: StorageEvent) => {
        if (event.key === null || event.key === storageKey) {
          onChange();
        }
      };
      window.addEventListener("storage", onStorage);
      window.addEventListener(LOCAL_CHANGE, onChange);
      return () => {
        window.removeEventListener("storage", onStorage);
        window.removeEventListener(LOCAL_CHANGE, onChange);
      };
    },
    [storageKey]
  );
  const layout = useSyncExternalStore(
    subscribe,
    () => parseSidebarLayout(readStored(storageKey)),
    () => DEFAULT_SIDEBAR_LAYOUT
  );
  const setLayout = useCallback(
    (next: SidebarLayoutSetting) => {
      try {
        window.localStorage.setItem(storageKey, next);
      } catch {
        // Blocked storage: the choice can't be kept, so it stays the default.
      }
      window.dispatchEvent(new Event(LOCAL_CHANGE));
    },
    [storageKey]
  );
  return [layout, setLayout];
};
