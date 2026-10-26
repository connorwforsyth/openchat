import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { z } from "zod";

import { shortcutIdSchema as idSchema } from "./ids";
import { keyComboSchema } from "./keys";

// The one shortcut registry (D10). Every consumer reads it: the React hooks,
// Kbd hints, the `?` dialog, the ⌘K palette and, in the desktop wave,
// Electron menu accelerators. Ids are stable API: 015's shell binds them and
// users' recorded overrides are stored against them, so rename none.

// The ids live in their own module, without Lingui, so the desktop shell's
// sandboxed preload can parse menu commands against them.
export const shortcutIdSchema = idSchema;
export type ShortcutId = z.infer<typeof shortcutIdSchema>;

/**
 * Where a shortcut is live. `global` works anywhere in the app; the others
 * only while that surface is mounted, so the same keys may mean different
 * things in scopes that never overlap.
 */
export const shortcutScopeSchema = z.enum(["global", "chat", "palette"]);
export type ShortcutScope = z.infer<typeof shortcutScopeSchema>;

/** Headings in the `?` dialog and the settings page. */
export const shortcutGroupSchema = z.enum([
  "general",
  "navigation",
  "conversation",
  "panels",
]);
export type ShortcutGroup = z.infer<typeof shortcutGroupSchema>;

export const shortcutDefinitionSchema = z.object({
  /** Lingui descriptor, translated where it's shown. */
  description: z.custom<MessageDescriptor>(
    (value) => typeof value === "object" && value !== null && "id" in value
  ),
  group: shortcutGroupSchema,
  id: shortcutIdSchema,
  /** Default combos, first one shown in hints. */
  keys: z.array(keyComboSchema).min(1).max(3),
  scope: shortcutScopeSchema,
});
export type ShortcutDefinition = z.infer<typeof shortcutDefinitionSchema>;

const define = (
  id: ShortcutId,
  keys: readonly string[],
  scope: ShortcutScope,
  group: ShortcutGroup,
  description: MessageDescriptor
): ShortcutDefinition =>
  shortcutDefinitionSchema.parse({ description, group, id, keys, scope });

/** In the order the `?` dialog lists them. Single keys follow 009's resolution. */
export const shortcutRegistry: readonly ShortcutDefinition[] = [
  define(
    "palette.open",
    ["Mod+K"],
    "global",
    "general",
    msg`Open the command palette`
  ),
  define(
    "help",
    ["?", "Mod+/"],
    "global",
    "general",
    msg`Show keyboard shortcuts`
  ),
  define("settings.open", ["Mod+,"], "global", "general", msg`Open settings`),
  define(
    "sidebar.toggle",
    ["Mod+B", "Mod+Shift+S"],
    "global",
    "navigation",
    msg`Toggle the sidebar`
  ),
  define(
    "chat.new",
    ["N", "Mod+Shift+O"],
    "global",
    "navigation",
    msg`New chat`
  ),
  define("chat.next", ["J"], "global", "navigation", msg`Next chat`),
  define("chat.prev", ["K"], "global", "navigation", msg`Previous chat`),
  define(
    "composer.focus",
    ["/"],
    "chat",
    "conversation",
    msg`Focus the composer`
  ),
  define("branch.prev", ["["], "chat", "conversation", msg`Previous branch`),
  define("branch.next", ["]"], "chat", "conversation", msg`Next branch`),
  define("run.stop", ["Escape"], "chat", "conversation", msg`Stop generating`),
  // ⌘. opens your Dot, as in ChatGPT (179); the model switcher moves over.
  define(
    "model.switch",
    ["Mod+Shift+."],
    "chat",
    "conversation",
    msg`Switch model`
  ),
  // ChatGPT's ⌘⇧C is taken by browser devtools, which a page can't override.
  define(
    "reply.copy",
    ["Mod+Shift+;"],
    "chat",
    "conversation",
    msg`Copy the last reply`
  ),
  define("panel.sandbox", ["S"], "chat", "panels", msg`Show or hide the files`),
  define(
    "panel.artifacts",
    ["A"],
    "chat",
    "panels",
    msg`Show or hide artifacts and tasks`
  ),
  // The sidebar's keys (176, 177), after ChatGPT's command registry.
  // ⌘⇧D (from 182) stays as a second key; nothing else binds it.
  define(
    "dot.open",
    ["Mod+.", "Mod+Shift+D"],
    "global",
    "navigation",
    msg`Open your Dot`
  ),
  define(
    "chat.archive",
    ["Mod+Shift+A"],
    "global",
    "conversation",
    msg`Archive the chat`
  ),
  define(
    "chat.pin",
    ["Mod+Alt+P"],
    "global",
    "conversation",
    msg`Pin or unpin the chat`
  ),
  define(
    "chat.markUnread",
    ["Mod+Shift+U"],
    "global",
    "conversation",
    msg`Mark the chat as unread`
  ),
  define(
    "sidebar.next",
    ["Mod+Shift+]"],
    "global",
    "navigation",
    msg`Next chat in the sidebar`
  ),
  define(
    "sidebar.prev",
    ["Mod+Shift+["],
    "global",
    "navigation",
    msg`Previous chat in the sidebar`
  ),
  define(
    "attention.next",
    ["Mod+Alt+A"],
    "global",
    "navigation",
    msg`Next chat that needs attention`
  ),
  define(
    "attention.filter",
    ["Mod+Alt+U"],
    "global",
    "navigation",
    msg`Show only Priority chats`
  ),
  define(
    "unread.clear",
    ["Shift+Escape"],
    "global",
    "navigation",
    msg`Mark every chat as read`
  ),
];

const byId: ReadonlyMap<ShortcutId, ShortcutDefinition> = new Map(
  shortcutRegistry.map((definition) => [definition.id, definition])
);

export const getShortcut = (id: ShortcutId): ShortcutDefinition => {
  const definition = byId.get(id);
  if (!definition) {
    // The id enum and the registry are defined together; a miss is a bug.
    throw new Error(`shortcut ${id} is not in the registry`);
  }
  return definition;
};

/** Scopes that are live at the same time as `scope` (global overlaps all). */
export const scopesOverlap = (a: ShortcutScope, b: ShortcutScope): boolean =>
  a === b || a === "global" || b === "global";
