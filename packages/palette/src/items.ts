import {
  libraryItemIdSchema,
  nameSchema,
} from "@workspace/contract/schemas/common";
import { conversationSchema } from "@workspace/contract/schemas/conversations";
import { shortcutIdSchema } from "@workspace/shortcuts/registry";
import { z } from "zod";

// What the palette lists (D14). Entries are data plus a `perform` callback:
// the palette never knows how to start a chat or open a panel, the app hands
// it closures, so web and desktop share one palette.

export const paletteSectionSchema = z.enum([
  "actions",
  "chats",
  "library",
  "settings",
]);
export type PaletteSection = z.infer<typeof paletteSectionSchema>;

export const paletteEntrySchema = z.object({
  disabled: z.boolean().default(false),
  /** Unique across the palette; cmdk tracks the selection by it. */
  id: z.string().min(1),
  /** Extra words that should find this entry ("dark" for Appearance). */
  keywords: z.array(z.string()).default([]),
  section: paletteSectionSchema,
  /** A registry shortcut to show as a Kbd hint. */
  shortcutId: shortcutIdSchema.nullable().default(null),
  subtitle: z.string().nullable().default(null),
  title: z.string().min(1),
});
export type PaletteEntry = z.infer<typeof paletteEntrySchema>;
export type PaletteEntryInput = z.input<typeof paletteEntrySchema>;

/** An entry the palette can run. `perform` runs after the palette closes. */
export type PaletteAction = PaletteEntry & { readonly perform: () => void };

export const paletteAction = (
  entry: PaletteEntryInput,
  perform: () => void
): PaletteAction => ({ ...paletteEntrySchema.parse(entry), perform });

/** The slice of a cached conversation the palette searches (D28: local first). */
export const cachedChatSchema = conversationSchema.pick({
  archived: true,
  id: true,
  pinned: true,
  title: true,
  updatedAt: true,
});
export type CachedChat = z.infer<typeof cachedChatSchema>;

/** Library items the palette can jump to. MCP servers and presets aren't "opened". */
export const paletteLibraryItemSchema = z.object({
  description: z.string().nullable(),
  id: libraryItemIdSchema,
  kind: z.enum(["agent", "prompt", "skill"]),
  name: nameSchema,
});
export type PaletteLibraryItem = z.infer<typeof paletteLibraryItemSchema>;
