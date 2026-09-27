import { describe, expect, it } from "vitest";

import {
  calendarDaysAgo,
  dateGroupFor,
  type GroupableChat,
  groupChats,
  orderedChats,
} from "./date-groups";

// Local times, so the tests hold in any time zone the runner uses.
const at = (day: number, hour = 12) =>
  new Date(2026, 8, day, hour, 0, 0).getTime();
const now = new Date(at(27, 9));

const chat = (
  id: string,
  time: number,
  pinned = false
): GroupableChat & { title: string } => ({
  id: id as GroupableChat["id"],
  lastMessageAt: new Date(time).toISOString(),
  pinned,
  title: id,
  updatedAt: new Date(time).toISOString(),
});

describe("calendarDaysAgo", () => {
  it("counts local calendar days, not 24-hour spans", () => {
    expect(calendarDaysAgo(at(27, 0), now)).toBe(0);
    expect(calendarDaysAgo(at(26, 23), now)).toBe(1);
    expect(calendarDaysAgo(at(20, 12), now)).toBe(7);
  });
});

describe("dateGroupFor", () => {
  it("buckets today, yesterday, the previous 7 days and older", () => {
    expect(dateGroupFor(at(27, 8), now)).toBe("today");
    expect(dateGroupFor(at(26, 23), now)).toBe("yesterday");
    expect(dateGroupFor(at(25), now)).toBe("previous7Days");
    expect(dateGroupFor(at(20), now)).toBe("previous7Days");
    expect(dateGroupFor(at(19), now)).toBe("older");
  });

  it("treats a clock-skewed future timestamp as today", () => {
    expect(dateGroupFor(at(28), now)).toBe("today");
  });
});

describe("groupChats", () => {
  const chats = [
    chat("old", at(1)),
    chat("today-early", at(27, 1)),
    chat("pinned-old", at(2), true),
    chat("yesterday", at(26)),
    chat("today-late", at(27, 8)),
    chat("week", at(23)),
  ];

  it("puts pinned chats first and the rest in date groups, newest first", () => {
    const grouped = groupChats(chats, now);
    expect(grouped.pinned.map((c) => c.id)).toEqual(["pinned-old"]);
    expect(
      grouped.groups.map((g) => [g.group, g.items.map((c) => c.id)])
    ).toEqual([
      ["today", ["today-late", "today-early"]],
      ["yesterday", ["yesterday"]],
      ["previous7Days", ["week"]],
      ["older", ["old"]],
    ]);
  });

  it("drops empty groups and falls back to updatedAt before any message", () => {
    const fresh = { ...chat("new", at(27)), lastMessageAt: null };
    const grouped = groupChats([fresh], now);
    expect(grouped.groups).toEqual([{ group: "today", items: [fresh] }]);
  });

  it("orders the sidebar the way J/K walks it", () => {
    expect(orderedChats(groupChats(chats, now)).map((c) => c.id)).toEqual([
      "pinned-old",
      "today-late",
      "today-early",
      "yesterday",
      "week",
      "old",
    ]);
  });
});
