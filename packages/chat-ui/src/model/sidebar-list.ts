import type { ConversationId } from "@workspace/contract/schemas/common";
import type { Conversation } from "@workspace/contract/schemas/conversations";
import { z } from "zod";

import { type GroupableChat, lastActivity } from "./date-groups";

// The sidebar's chat list (177, 181): pinned chats in their own section, then
// one flat list of the rest, sorted by the user's choice and paged with "Show
// more" so the DOM stays bounded without a virtualiser. No date headings in
// any sort, as in ChatGPT's sidebar (Connor, 2026-10-20). Chats that sit in
// Priority are left out of the flat list, so none shows twice.

export const sidebarSortSchema = z.enum(["updated", "created"]);
export type SidebarSort = z.infer<typeof sidebarSortSchema>;

/** Rows per page of "Show more". */
export const SIDEBAR_PAGE_SIZE = 50;

export type ListableChat = GroupableChat & Pick<Conversation, "createdAt">;

export interface SidebarList<T> {
  /** More chats than `limit` shows. */
  readonly hasMore: boolean;
  /** A page of the unpinned chats not in Priority, in the chosen order. */
  readonly items: readonly T[];
  readonly pinned: readonly T[];
  /** Every chat `items` pages over. */
  readonly total: number;
}

const created = (chat: ListableChat): number =>
  new Date(chat.createdAt).getTime();

const sortKey = (sort: SidebarSort) =>
  sort === "created" ? created : lastActivity;

const none: ReadonlySet<ConversationId> = new Set();

/** Pinned chats, then a page of the rest; `exclude` (Priority) left out. */
export const buildSidebarList = <T extends ListableChat>(
  chats: readonly T[],
  {
    exclude = none,
    limit,
    sort,
  }: {
    exclude?: ReadonlySet<ConversationId>;
    limit: number;
    sort: SidebarSort;
  }
): SidebarList<T> => {
  const key = sortKey(sort);
  const sorted = [...chats].sort((a, b) => key(b) - key(a));
  const pinned = sorted.filter((chat) => chat.pinned);
  const rest = sorted.filter((chat) => !(chat.pinned || exclude.has(chat.id)));
  const items = rest.slice(0, Math.max(0, limit));
  return {
    hasMore: rest.length > items.length,
    items,
    pinned,
    total: rest.length,
  };
};

/** The rows in the order they're shown, for ⇧⌘[ / ⇧⌘] and range selection. */
export const visibleOrder = <T>(
  list: SidebarList<T>,
  priority: readonly T[] = []
): readonly T[] => [...priority, ...list.pinned, ...list.items];
