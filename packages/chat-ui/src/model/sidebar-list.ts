import type { Conversation } from "@workspace/contract/schemas/conversations";
import { z } from "zod";

import {
  type DateGroup,
  dateGroupFor,
  type GroupableChat,
  lastActivity,
} from "./date-groups";

// The sidebar's chat list (177): pinned first, then the rest sorted by the
// user's choice and paged with "Show more", so the DOM stays bounded without
// a virtualiser. "Last updated" keeps the date headings (decision for now;
// see QUESTIONS-FOR-CONNOR); "Created" is one flat list, since a date heading
// over a creation order would read as activity.

export const sidebarSortSchema = z.enum(["updated", "created"]);
export type SidebarSort = z.infer<typeof sidebarSortSchema>;

/** Rows per page of "Show more". */
export const SIDEBAR_PAGE_SIZE = 50;

export type ListableChat = GroupableChat & Pick<Conversation, "createdAt">;

export type ListSectionKey = DateGroup | "all";

export interface ListSection<T> {
  readonly items: readonly T[];
  readonly key: ListSectionKey;
}

export interface SidebarList<T> {
  /** More unpinned chats than `limit` shows. */
  readonly hasMore: boolean;
  readonly pinned: readonly T[];
  readonly sections: readonly ListSection<T>[];
  /** Every unpinned chat, before paging. */
  readonly total: number;
}

const created = (chat: ListableChat): number =>
  new Date(chat.createdAt).getTime();

const sortKey = (sort: SidebarSort) =>
  sort === "created" ? created : lastActivity;

/** Pinned chats, then a page of the rest in sections; empty sections dropped. */
export const buildSidebarList = <T extends ListableChat>(
  chats: readonly T[],
  { limit, now, sort }: { limit: number; now: Date; sort: SidebarSort }
): SidebarList<T> => {
  const key = sortKey(sort);
  const sorted = [...chats].sort((a, b) => key(b) - key(a));
  const pinned = sorted.filter((chat) => chat.pinned);
  const rest = sorted.filter((chat) => !chat.pinned);
  const page = rest.slice(0, Math.max(0, limit));
  const sections: ListSection<T>[] = [];
  for (const chat of page) {
    const sectionKey: ListSectionKey =
      sort === "created" ? "all" : dateGroupFor(lastActivity(chat), now);
    const last = sections.at(-1);
    if (last?.key === sectionKey) {
      sections[sections.length - 1] = {
        items: [...last.items, chat],
        key: sectionKey,
      };
    } else {
      sections.push({ items: [chat], key: sectionKey });
    }
  }
  return {
    hasMore: rest.length > page.length,
    pinned,
    sections,
    total: rest.length,
  };
};

/** The rows in the order they're shown, for ⇧⌘[ / ⇧⌘] and range selection. */
export const visibleOrder = <T>(list: SidebarList<T>): readonly T[] => [
  ...list.pinned,
  ...list.sections.flatMap((section) => section.items),
];
