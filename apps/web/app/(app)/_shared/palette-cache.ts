import {
  type CachedChat,
  cachedChatSchema,
  type PaletteLibraryItem,
  paletteLibraryItemSchema,
} from "@workspace/palette/items";
import { z } from "zod";

// ⌘K reads what the app already has in its query cache (D28) instead of
// fetching: conversation and library list pages, however many are loaded.
// The cache is shaped by other workstreams, so parse leniently: an entry that
// doesn't fit is skipped, never fatal.

const pageSchema = z.object({ items: z.array(z.unknown()) });
/** `useInfiniteQuery` data: `{ pages: [...] }`. */
const infiniteSchema = z.object({ pages: z.array(pageSchema) });

const itemsOf = (data: unknown): readonly unknown[] => {
  const infinite = infiniteSchema.safeParse(data);
  if (infinite.success) {
    return infinite.data.pages.flatMap((page) => page.items);
  }
  const single = pageSchema.safeParse(data);
  return single.success ? single.data.items : [];
};

const unique = <T extends { readonly id: string }>(
  items: readonly T[]
): readonly T[] => [...new Map(items.map((item) => [item.id, item])).values()];

export const chatsFromCache = (
  entries: readonly unknown[]
): readonly CachedChat[] =>
  unique(
    entries.flatMap(itemsOf).flatMap((item) => {
      const parsed = cachedChatSchema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    })
  );

export const libraryFromCache = (
  entries: readonly unknown[]
): readonly PaletteLibraryItem[] =>
  unique(
    entries.flatMap(itemsOf).flatMap((item) => {
      const parsed = paletteLibraryItemSchema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    })
  );
