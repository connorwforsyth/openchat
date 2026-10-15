import { z } from "zod";

import { isEditableTarget, keyTarget } from "./editable";

// The chat shell's keyboard shortcuts (D10; ticket 009's Workspace keys), as
// data. Ticket 024's `packages/shortcuts` absorbs this registry: keep the ids
// stable, since the ⌘K palette, the `?` help, Kbd hints and (on desktop) menu
// accelerators all key off them. Labels live in `use-shortcut-labels.ts` so
// they go through Lingui.

export const shortcutIdSchema = z.enum([
  "chat.new",
  "composer.focus",
  "chat.next",
  "chat.prev",
  "branch.prev",
  "branch.next",
  "panel.sandbox",
  "panel.artifacts",
  "artifact.prev",
  "artifact.next",
  "help",
  "sidebar.toggle",
  "palette.open",
]);
export type ShortcutId = z.infer<typeof shortcutIdSchema>;

/**
 * `key` is `KeyboardEvent.key`, lower-cased for letters. `mod` is ⌘ on Apple
 * platforms and Ctrl elsewhere. Single-key shortcuts (no `mod`) only fire
 * when focus isn't in something you type into.
 */
export const shortcutSchema = z.object({
  id: shortcutIdSchema,
  key: z.string().min(1),
  mod: z.boolean(),
  /** `global`: works anywhere, even while typing. `view`: single keys, not while typing. */
  scope: z.enum(["global", "view"]),
});
export type Shortcut = z.infer<typeof shortcutSchema>;

export const shortcuts: readonly Shortcut[] = [
  { id: "chat.new", key: "n", mod: false, scope: "view" },
  { id: "composer.focus", key: "/", mod: false, scope: "view" },
  { id: "chat.next", key: "j", mod: false, scope: "view" },
  { id: "chat.prev", key: "k", mod: false, scope: "view" },
  { id: "branch.prev", key: "[", mod: false, scope: "view" },
  { id: "branch.next", key: "]", mod: false, scope: "view" },
  { id: "panel.sandbox", key: "s", mod: false, scope: "view" },
  { id: "panel.artifacts", key: "a", mod: false, scope: "view" },
  // Shift+[ and Shift+]: Shift is ignored by matching, so the key is the
  // character it types.
  { id: "artifact.prev", key: "{", mod: false, scope: "view" },
  { id: "artifact.next", key: "}", mod: false, scope: "view" },
  { id: "help", key: "?", mod: false, scope: "view" },
  { id: "sidebar.toggle", key: "b", mod: true, scope: "global" },
  { id: "palette.open", key: "k", mod: true, scope: "global" },
];

export const shortcutById = (id: ShortcutId): Shortcut => {
  const found = shortcuts.find((shortcut) => shortcut.id === id);
  if (!found) {
    // The registry lists every id; reaching this is a bug, not bad input.
    throw new Error(`No shortcut registered for ${id}`);
  }
  return found;
};

/** The parts of a `KeyboardEvent` matching reads, so tests can pass plain objects. */
export interface KeyPress {
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly key: string;
  readonly metaKey: boolean;
}

const normaliseKey = (key: string): string =>
  key.length === 1 ? key.toLowerCase() : key;

/**
 * Which shortcut a key press means, if any. Shift is ignored so `?` (Shift+/)
 * and a caps-locked `N` still match; any other modifier must be exactly `mod`.
 */
export const matchShortcut = (
  press: KeyPress,
  isApple: boolean
): Shortcut | undefined => {
  const mod = isApple ? press.metaKey : press.ctrlKey;
  const otherModifier = isApple ? press.ctrlKey : press.metaKey;
  if (press.altKey || otherModifier) {
    return;
  }
  const key = normaliseKey(press.key);
  return shortcuts.find(
    (shortcut) => shortcut.key === key && shortcut.mod === mod
  );
};

/** The keys to show in a Kbd hint, e.g. `["⌘", "B"]` or `["Ctrl", "B"]`. */
export const shortcutKeys = (
  shortcut: Pick<Shortcut, "key" | "mod">,
  isApple: boolean
): readonly string[] => {
  const key =
    shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key;
  if (!shortcut.mod) {
    return [key];
  }
  return [isApple ? "⌘" : "Ctrl", key];
};

/**
 * True when a single-key shortcut must leave this key press alone: someone is
 * typing (through shadow roots too, like the Workspace editor's) or a widget
 * that owns its keys has focus. Hotkeys outside the registry (the web app's
 * theme key) use it too.
 */
export const isTypingEvent = (
  event: Pick<Event, "composedPath" | "target">
): boolean => isEditableTarget(keyTarget(event));
