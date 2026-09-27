"use client";

import { err, ok, type Result } from "@workspace/shared/result";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

import { type Platform, platformFromUserAgent } from "../keys";
import {
  checkRecording,
  type RecordingError,
  resetOverride,
  resolveBindings,
  type ShortcutBindings,
  type ShortcutOverrides,
  setOverride,
} from "../overrides";
import type {
  OverridesStore,
  OverridesStoreError,
} from "../ports/overrides-store";
import type { ShortcutId } from "../registry";

// The live bindings for a tree: the registry's defaults with the user's
// recorded overrides on top, plus the platform for ⌘ vs Ctrl. Hooks work
// without a provider (defaults, detected platform), so a component that binds
// a shortcut renders in isolation and in tests.

export interface ShortcutsContextValue {
  readonly bindings: ShortcutBindings;
  /** Sets an empty list: the shortcut stays listed but does nothing. */
  readonly disable: (id: ShortcutId) => void;
  readonly helpOpen: boolean;
  readonly overrides: ShortcutOverrides;
  readonly platform: Platform;
  /** Checks and saves a recorded combo; the error says why it was refused. */
  readonly record: (
    id: ShortcutId,
    combo: string
  ) => Result<string, RecordingError>;
  readonly reset: (id: ShortcutId) => void;
  readonly resetAll: () => void;
  /** The last failed save, so settings can say changes won't stick. */
  readonly saveError: OverridesStoreError | null;
  readonly setHelpOpen: (open: boolean) => void;
}

const noop = () => undefined;
const defaultBindings = resolveBindings({});

const ShortcutsContext = createContext<ShortcutsContextValue | null>(null);

const subscribeNever = () => noop;

/**
 * The platform from the browser. The server renders ⌘ (most of the people
 * who read Kbd hints closely are on a Mac); the client corrects it after
 * hydration without a mismatch, via `useSyncExternalStore`.
 */
export const useDetectedPlatform = (): Platform =>
  useSyncExternalStore(
    subscribeNever,
    () => platformFromUserAgent(navigator.userAgent),
    () => "mac"
  );

export interface ShortcutsProviderProps {
  readonly children: ReactNode;
  /** Overrides the detected platform (the desktop app knows it for sure). */
  readonly platform?: Platform;
  /** Where overrides persist; without one they last until reload. */
  readonly store?: OverridesStore;
}

export const ShortcutsProvider = ({
  children,
  platform: platformProp,
  store,
}: ShortcutsProviderProps) => {
  const detected = useDetectedPlatform();
  const platform = platformProp ?? detected;
  const [overrides, setOverrides] = useState<ShortcutOverrides>({});
  const [helpOpen, setHelpOpen] = useState(false);
  const [saveError, setSaveError] = useState<OverridesStoreError | null>(null);

  useEffect(() => {
    if (!store) {
      return;
    }
    let live = true;
    store.load().then((loaded) => {
      // Defaults stand in for anything unreadable; shortcuts keep working.
      if (live && loaded.ok) {
        setOverrides(loaded.value);
      }
    });
    return () => {
      live = false;
    };
  }, [store]);

  const commit = useCallback(
    (next: ShortcutOverrides) => {
      setOverrides(next);
      store?.save(next).then((saved) => {
        setSaveError(saved.ok ? null : saved.error);
      });
    },
    [store]
  );

  const bindings = useMemo(() => resolveBindings(overrides), [overrides]);

  const record = useCallback(
    (id: ShortcutId, combo: string): Result<string, RecordingError> => {
      const checked = checkRecording(bindings, id, combo);
      if (!checked.ok) {
        return err(checked.error);
      }
      commit(setOverride(overrides, id, [checked.value]));
      return ok(checked.value);
    },
    [bindings, commit, overrides]
  );

  const value = useMemo<ShortcutsContextValue>(
    () => ({
      bindings,
      disable: (id) => commit(setOverride(overrides, id, [])),
      helpOpen,
      overrides,
      platform,
      record,
      reset: (id) => commit(resetOverride(overrides, id)),
      resetAll: () => commit({}),
      saveError,
      setHelpOpen,
    }),
    [bindings, commit, helpOpen, overrides, platform, record, saveError]
  );

  return (
    <ShortcutsContext.Provider value={value}>
      {children}
    </ShortcutsContext.Provider>
  );
};

/** The live bindings, or the registry's defaults outside a provider. */
export const useShortcuts = (): ShortcutsContextValue => {
  const context = useContext(ShortcutsContext);
  const platform = useDetectedPlatform();
  const [helpOpen, setHelpOpen] = useState(false);
  return useMemo(
    () =>
      context ?? {
        bindings: defaultBindings,
        disable: noop,
        helpOpen,
        overrides: {},
        platform,
        record: () => err({ type: "invalid" as const }),
        reset: noop,
        resetAll: noop,
        saveError: null,
        setHelpOpen,
      },
    [context, helpOpen, platform]
  );
};
