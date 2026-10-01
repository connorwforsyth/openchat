import { fixtureId, fixtureTime } from "@workspace/contract/fixtures";
import type { SearchHit } from "@workspace/contract/schemas/search";
import { describe, expect, it } from "vitest";

import { mergeChatResults, searchCachedChats, staleHitsFor } from "./chats";
import type { CachedChat } from "./items";

const chat = (n: number, title: string, extra: Partial<CachedChat> = {}) => ({
  archived: false,
  id: fixtureId("conversation", n),
  pinned: false,
  title,
  updatedAt: fixtureTime(n),
  ...extra,
});

const hit = (
  n: number,
  rank: number,
  extra: Partial<SearchHit> = {}
): SearchHit => ({
  conversationId: fixtureId("conversation", n),
  highlights: [{ end: 6, start: 0 }],
  messageId: fixtureId("message", n),
  rank,
  role: "user",
  snippet: `deploy to staging (${n})`,
  title: `Server chat ${n}`,
  updatedAt: fixtureTime(n),
  ...extra,
});

const cached = [
  chat(1, "Deploy checklist"),
  chat(2, "Holiday plans"),
  chat(3, "Deploy script bug", { pinned: true }),
  chat(4, "Old deploy notes", { archived: true }),
];

describe("searchCachedChats", () => {
  it("lists recent, unarchived chats (pinned first) for an empty query", () => {
    expect(searchCachedChats("", cached).map((c) => c.title)).toEqual([
      "Deploy script bug",
      "Holiday plans",
      "Deploy checklist",
    ]);
  });

  it("ranks matches, archived included when searched for", () => {
    expect(searchCachedChats("deploy", cached).map((c) => c.title)).toEqual([
      "Deploy script bug",
      "Deploy checklist",
      "Old deploy notes",
    ]);
  });
});

describe("mergeChatResults", () => {
  it("keeps cached results in place and appends new server hits by rank", () => {
    const local = searchCachedChats("deploy", cached);
    const merged = mergeChatResults(local, [
      hit(7, 0.2),
      hit(8, 0.9),
      hit(7, 0.5),
    ]);
    expect(merged.map((c) => c.id)).toEqual([
      fixtureId("conversation", 3),
      fixtureId("conversation", 1),
      fixtureId("conversation", 4),
      fixtureId("conversation", 8),
      fixtureId("conversation", 7),
    ]);
    expect(merged.at(-1)).toMatchObject({
      snippet: { snippet: "deploy to staging (7)" },
      source: "server",
    });
  });

  it("adds a message snippet to a chat the cache already found", () => {
    const local = searchCachedChats("deploy", cached);
    const [first] = mergeChatResults(local, [hit(3, 0.4)]);
    expect(first).toMatchObject({
      id: fixtureId("conversation", 3),
      messageId: fixtureId("message", 3),
      source: "cache",
      title: "Deploy script bug",
    });
  });

  it("title-only hits carry no snippet", () => {
    const [only] = mergeChatResults([], [hit(9, 1, { messageId: null })]);
    expect(only?.snippet).toBeNull();
  });
});

describe("staleHitsFor", () => {
  const hits = [
    hit(1, 0.9, { snippet: "pick a query plan", title: "Planning" }),
    hit(2, 0.5, { snippet: "the queue is full", title: "Ops" }),
    hit(3, 0.1, { snippet: "nothing here", title: "Query selection" }),
  ];

  it("keeps the hits whose words still start with what's typed, best first", () => {
    expect(staleHitsFor("quer", hits).map((h) => h.conversationId)).toEqual([
      fixtureId("conversation", 3),
      fixtureId("conversation", 1),
    ]);
    expect(staleHitsFor("que", hits)).toHaveLength(3);
    expect(staleHitsFor("quex", hits)).toEqual([]);
  });

  it("needs every word, skips -word, and is empty for an empty query", () => {
    expect(
      staleHitsFor("query sel", hits).map((h) => h.conversationId)
    ).toEqual([fixtureId("conversation", 3)]);
    // Words may match across title and snippet.
    expect(
      staleHitsFor("planning query", hits).map((h) => h.conversationId)
    ).toEqual([fixtureId("conversation", 1)]);
    expect(staleHitsFor("queue -ops", hits)).toHaveLength(1);
    expect(staleHitsFor("  ", hits)).toEqual([]);
  });

  it("re-ranks with local scores so the merge orders them", () => {
    const [best] = staleHitsFor("quer", hits);
    expect(best?.rank).toBeGreaterThan(0);
    expect(best?.rank).toBeLessThanOrEqual(1.01);
  });
});
