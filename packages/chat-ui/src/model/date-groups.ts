import type { Conversation } from "@workspace/contract/schemas/conversations";
import { z } from "zod";

// The sidebar's chat list (ticket 009's Classic sidebar): pinned chats first,
// then Today / Yesterday / Previous 7 days / Older by last activity, in the
// viewer's local calendar. `now` is a parameter so tests control the clock.

export const dateGroupSchema = z.enum([
  "today",
  "yesterday",
  "previous7Days",
  "older",
]);
export type DateGroup = z.infer<typeof dateGroupSchema>;

/** The fields grouping reads; a full `Conversation` fits. */
export type GroupableChat = Pick<
  Conversation,
  "id" | "lastMessageAt" | "pinned" | "updatedAt"
>;

export interface ChatGroup<T> {
  readonly group: DateGroup;
  readonly items: readonly T[];
}

export interface GroupedChats<T> {
  readonly groups: readonly ChatGroup<T>[];
  readonly pinned: readonly T[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_DAYS = 7;

/** When a chat last moved: its last message, or its last edit before any. */
export const lastActivity = (chat: GroupableChat): number =>
  new Date(chat.lastMessageAt ?? chat.updatedAt).getTime();

const startOfLocalDay = (time: number): number => {
  const day = new Date(time);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
};

/** Whole local calendar days from `time` to `now` (0 for today, negative for the future). */
export const calendarDaysAgo = (time: number, now: Date): number =>
  // Rounding absorbs the 23- and 25-hour days around DST changes.
  Math.round((startOfLocalDay(now.getTime()) - startOfLocalDay(time)) / DAY_MS);

export const dateGroupFor = (time: number, now: Date): DateGroup => {
  const days = calendarDaysAgo(time, now);
  if (days <= 0) {
    return "today";
  }
  if (days === 1) {
    return "yesterday";
  }
  return days <= WEEK_DAYS ? "previous7Days" : "older";
};

const byActivity = (a: GroupableChat, b: GroupableChat): number =>
  lastActivity(b) - lastActivity(a);

/** Pinned chats, then the rest by date group; newest first, empty groups dropped. */
export const groupChats = <T extends GroupableChat>(
  chats: readonly T[],
  now: Date
): GroupedChats<T> => {
  const sorted = [...chats].sort(byActivity);
  const buckets = new Map<DateGroup, T[]>(
    dateGroupSchema.options.map((group) => [group, []])
  );
  const pinned: T[] = [];
  for (const chat of sorted) {
    if (chat.pinned) {
      pinned.push(chat);
    } else {
      buckets.get(dateGroupFor(lastActivity(chat), now))?.push(chat);
    }
  }
  return {
    groups: dateGroupSchema.options.flatMap((group) => {
      const items = buckets.get(group) ?? [];
      return items.length > 0 ? [{ group, items }] : [];
    }),
    pinned,
  };
};

/** The sidebar's visual order, for J/K: pinned first, then each group. */
export const orderedChats = <T extends GroupableChat>(
  grouped: GroupedChats<T>
): readonly T[] => [
  ...grouped.pinned,
  ...grouped.groups.flatMap((group) => group.items),
];
