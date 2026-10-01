"use client";

import { type RawHotkey, useHotkeys } from "@tanstack/react-hotkeys";
import { useEffect, useMemo, useRef } from "react";

import { onDesktopMenuCommand } from "../desktop";

import {
  comboKeycaps,
  formatCombo,
  parseCombo,
  worksWhileTyping,
} from "../keys";
import type { ShortcutId } from "../registry";
import { useShortcuts } from "./context";

// The hooks callers use. They take registry ids, never raw keys, and never
// expose TanStack types: swapping the library (D10 names react-hotkeys-hook as
// the fallback) only touches this file.

export interface UseShortcutOptions {
  /** Off while, say, a dialog owns the keyboard. Defaults to on. */
  readonly enabled?: boolean;
}

const noop = () => undefined;

const toRawHotkey = (combo: string): RawHotkey | null => {
  const parsed = parseCombo(combo);
  if (!parsed.ok) {
    return null;
  }
  const { key, modifiers } = parsed.value;
  return {
    alt: modifiers.includes("Alt"),
    ctrl: modifiers.includes("Ctrl"),
    key,
    meta: modifiers.includes("Meta"),
    mod: modifiers.includes("Mod"),
    shift: modifiers.includes("Shift"),
  };
};

/**
 * Runs `handler` when any of the shortcut's live combos is pressed. Single
 * keys are ignored while focus is in a text field or the composer; combos
 * with ⌘/Ctrl/Alt (and Escape) work everywhere. In the desktop shell the
 * native menu's item for the shortcut runs it too (117), whatever has focus:
 * a menu click is never typing.
 */
export const useShortcut = (
  id: ShortcutId,
  handler: () => void,
  { enabled = true }: UseShortcutOptions = {}
): void => {
  const { bindings, platform } = useShortcuts();
  const combos = bindings.get(id) ?? [];
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  useEffect(
    () => (enabled ? onDesktopMenuCommand(id, () => latest.current()) : noop),
    [enabled, id]
  );
  useHotkeys(
    combos.flatMap((combo) => {
      const hotkey = toRawHotkey(combo);
      return hotkey
        ? [
            {
              callback: () => handler(),
              hotkey,
              options: {
                // Another shortcut on the same keys in a disjoint scope is fine.
                conflictBehavior: "allow" as const,
                enabled,
                ignoreInputs: !worksWhileTyping(combo),
                platform,
              },
            },
          ]
        : [];
    })
  );
};

export interface ShortcutHint {
  /** The first live combo, or `null` when the user switched it off. */
  readonly combo: string | null;
  /** Keycaps to draw: `["⌘", "K"]`. */
  readonly keycaps: readonly string[];
  /** One string for `title` and menus: `⌘K` / `Ctrl+K`. */
  readonly label: string;
}

/** How to show a shortcut's current keys on this platform. */
export const useShortcutHint = (id: ShortcutId): ShortcutHint => {
  const { bindings, platform } = useShortcuts();
  const combo = bindings.get(id)?.[0] ?? null;
  return useMemo(
    () => ({
      combo,
      keycaps: combo ? comboKeycaps(combo, platform) : [],
      label: combo ? formatCombo(combo, platform) : "",
    }),
    [combo, platform]
  );
};
