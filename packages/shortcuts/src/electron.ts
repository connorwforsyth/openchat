import { parseCombo } from "./keys";
import type { ShortcutBindings } from "./overrides";
import { getShortcut, type ShortcutId } from "./registry";

// Electron menu accelerators from the registry (D10, D14: "native menus are
// generated from the shortcut registry"). For the desktop wave; pure, so it
// runs in the main process without React or a DOM.

const FUNCTION_KEY = /^F\d{1,2}$/;

const ELECTRON_KEYS: Readonly<Record<string, string>> = {
  "+": "Plus",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  ArrowUp: "Up",
  Escape: "Esc",
};

const ELECTRON_MODIFIERS = {
  Alt: "Alt",
  Ctrl: "Control",
  Meta: "Super",
  Mod: "CommandOrControl",
  Shift: "Shift",
} as const;

/**
 * The accelerator for a combo, like `CommandOrControl+K`, or `null` when it
 * has no modifier: a menu accelerator fires even while typing, so single-key
 * shortcuts (and Escape) stay in the renderer, which knows when focus is in a
 * text field or a dialog is open.
 */
export const comboToAccelerator = (combo: string): string | null => {
  const parsed = parseCombo(combo);
  if (!parsed.ok) {
    return null;
  }
  const { key, modifiers } = parsed.value;
  // Function keys never type text; everything else needs ⌘/Ctrl/Alt, and
  // Escape stays with the renderer so it can close dialogs first.
  const needsModifier = !FUNCTION_KEY.test(key);
  if (needsModifier && !modifiers.some((modifier) => modifier !== "Shift")) {
    return null;
  }
  return [
    ...modifiers.map((modifier) => ELECTRON_MODIFIERS[modifier]),
    ELECTRON_KEYS[key] ?? key,
  ].join("+");
};

/** The accelerator for a shortcut's first live combo, honouring the user's overrides. */
export const electronAccelerator = (
  id: ShortcutId,
  bindings?: ShortcutBindings
): string | null => {
  const [first] = bindings?.get(id) ?? getShortcut(id).keys;
  return first ? comboToAccelerator(first) : null;
};
