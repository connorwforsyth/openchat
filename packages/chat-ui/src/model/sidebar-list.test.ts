import { describe, expect, it } from "vitest";

import {
  buildSidebarList,
  type ListableChat,
  visibleOrder,
} from "./sidebar-list";

const at = (day: number, hour = 12) =>
  new Date(2026, 8, day, hour, 0, 0).toISOString();
const now = new Date(2026, 8, 27, 18);

const chat = (
  id: string,
  {
    active,
    created,
    pinned = false,
  }: { active: string; created: string; pinned?: boolean }
): ListableChat => ({
  createdAt: created,
  id: id as ListableChat["id"],
  lastMessageAt: active,
  pinned,
  updatedAt: active,
});

const chats = [
  chat("old-but-busy", { active: at(27), created: at(1) }),
  chat("yesterday", { active: at(26), created: at(26) }),
  chat("fresh", { active: at(25), created: at(25, 14) }),
  chat("pinned", { active: at(2), created: at(2), pinned: true }),
];

const ids = (items: readonly ListableChat[]) => items.map((each) => each.id);

describe("buildSidebarList", () => {
  it("sorts by last update with date headings, pinned apart", () => {
    const list = buildSidebarList(chats, { limit: 50, now, sort: "updated" });
    expect(ids(list.pinned)).toEqual(["pinned"]);
    expect(
      list.sections.map((section) => [section.key, ids(section.items)])
    ).toEqual([
      ["today", ["old-but-busy"]],
      ["yesterday", ["yesterday"]],
      ["previous7Days", ["fresh"]],
    ]);
  });

  it("sorts by creation as one flat list", () => {
    const list = buildSidebarList(chats, { limit: 50, now, sort: "created" });
    expect(
      list.sections.map((section) => [section.key, ids(section.items)])
    ).toEqual([["all", ["yesterday", "fresh", "old-but-busy"]]]);
  });

  it("pages the unpinned chats and says there's more", () => {
    const list = buildSidebarList(chats, { limit: 2, now, sort: "updated" });
    expect(ids(visibleOrder(list))).toEqual([
      "pinned",
      "old-but-busy",
      "yesterday",
    ]);
    expect(list.hasMore).toBe(true);
    expect(list.total).toBe(3);
    expect(
      buildSidebarList(chats, { limit: 3, now, sort: "updated" }).hasMore
    ).toBe(false);
  });
});
