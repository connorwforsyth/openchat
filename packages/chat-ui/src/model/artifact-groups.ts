import { calendarDaysAgo } from "./date-groups";

// The Artifacts page's list (124), grouped as Claude's page does: Today,
// Yesterday, the rest of the last week, then one group per month, newest
// first, in the viewer's local calendar. `now` is a parameter so tests
// control the clock.

export type ArtifactGroupKey =
  | { readonly type: "today" }
  | { readonly type: "yesterday" }
  | { readonly type: "previous7Days" }
  /** `month` is 0-based, as `Date` has it. */
  | { readonly month: number; readonly type: "month"; readonly year: number };

export interface ArtifactGroup<T> {
  readonly id: string;
  readonly items: readonly T[];
  readonly key: ArtifactGroupKey;
}

const WEEK_DAYS = 7;

export const artifactGroupFor = (time: number, now: Date): ArtifactGroupKey => {
  const days = calendarDaysAgo(time, now);
  if (days <= 0) {
    return { type: "today" };
  }
  if (days === 1) {
    return { type: "yesterday" };
  }
  if (days <= WEEK_DAYS) {
    return { type: "previous7Days" };
  }
  const date = new Date(time);
  return { month: date.getMonth(), type: "month", year: date.getFullYear() };
};

const idOf = (key: ArtifactGroupKey): string =>
  key.type === "month" ? `${key.year}-${key.month + 1}` : key.type;

/**
 * Items in groups, keeping the order they came in (the server sorts by
 * when the viewer last saw each). `timeOf` is the time that places one.
 */
export const groupArtifacts = <T>(
  items: readonly T[],
  timeOf: (item: T) => number,
  now: Date
): ArtifactGroup<T>[] => {
  const groups: { id: string; items: T[]; key: ArtifactGroupKey }[] = [];
  const byId = new Map<string, (typeof groups)[number]>();
  for (const item of items) {
    const key = artifactGroupFor(timeOf(item), now);
    const id = idOf(key);
    let group = byId.get(id);
    if (!group) {
      group = { id, items: [], key };
      byId.set(id, group);
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
};
