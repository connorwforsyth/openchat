import { z } from "zod";

// The shortcut ids (D10). Ids are stable API: 015's shell binds them, users'
// recorded overrides are stored against them, and the desktop shell's menu
// sends them to the page as commands (117). Rename none.

export const shortcutIdSchema = z.enum([
  "palette.open",
  "help",
  "settings.open",
  "sidebar.toggle",
  "chat.new",
  "chat.next",
  "chat.prev",
  "composer.focus",
  "branch.prev",
  "branch.next",
  "run.stop",
  "model.switch",
  "reply.copy",
  "panel.sandbox",
  "panel.artifacts",
  "artifact.prev",
  "artifact.next",
]);
export type ShortcutId = z.infer<typeof shortcutIdSchema>;
