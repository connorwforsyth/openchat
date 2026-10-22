import type { ConversationId } from "@workspace/contract/schemas/common";
import { describe, expect, it } from "vitest";

import {
  type AttentionChat,
  attentionFor,
  isUnread,
  needsAttention,
  nextNeedingAttention,
  unreadMarker,
} from "./attention";

const id = (value: string) => value as ConversationId;

const chat = (
  name: string,
  lastMessageAt: string | null,
  lastReadAt: string | null
): AttentionChat => ({
  id: id(name),
  lastMessageAt,
  myState: { lastReadAt },
  updatedAt: "2026-10-01T00:00:00.000Z",
});

describe("isUnread", () => {
  it("is unread when a message is newer than the read marker", () => {
    expect(
      isUnread(
        chat("a", "2026-10-02T10:00:00.000Z", "2026-10-02T09:00:00.000Z")
      )
    ).toBe(true);
  });

  it("is read when the marker has caught up", () => {
    expect(
      isUnread(
        chat("a", "2026-10-02T10:00:00.000Z", "2026-10-02T10:00:00.000Z")
      )
    ).toBe(false);
  });

  it("treats a never-opened chat with activity as unread", () => {
    expect(isUnread(chat("a", "2026-10-02T10:00:00.000Z", null))).toBe(true);
    expect(isUnread(chat("b", null, null))).toBe(false);
  });
});

describe("attentionFor", () => {
  it("prefers a run signal over unread", () => {
    const unread = chat(
      "a",
      "2026-10-02T10:00:00.000Z",
      "2026-10-01T00:00:00.000Z"
    );
    expect(attentionFor(unread, "running")).toBe("running");
    expect(attentionFor(unread, undefined)).toBe("unread");
    expect(attentionFor(chat("b", null, null), undefined)).toBeNull();
  });
});

describe("needsAttention", () => {
  const read = chat(
    "read",
    "2026-10-02T10:00:00.000Z",
    "2026-10-02T10:00:00.000Z"
  );
  const unreadOld = chat(
    "old",
    "2026-10-02T08:00:00.000Z",
    "2026-10-01T00:00:00.000Z"
  );
  const unreadNew = chat(
    "new",
    "2026-10-02T09:00:00.000Z",
    "2026-10-01T00:00:00.000Z"
  );
  const running = chat("run", "2026-10-01T09:00:00.000Z", null);
  const waiting = chat("wait", "2026-10-01T08:00:00.000Z", null);
  const signals = new Map([
    [id("run"), "running" as const],
    [id("wait"), "awaiting_approval" as const],
  ]);

  it("lists approvals, then running, then unread newest first; skips read chats", () => {
    const items = needsAttention(
      [read, unreadOld, running, unreadNew, waiting],
      signals
    );
    expect(items.map((item) => [item.chat.id, item.attention])).toEqual([
      ["wait", "awaiting_approval"],
      ["run", "running"],
      ["new", "unread"],
      ["old", "unread"],
    ]);
  });

  it("jumps to the next one, wrapping round", () => {
    const items = needsAttention([unreadOld, unreadNew], new Map());
    expect(nextNeedingAttention(items, null)).toBe("new");
    expect(nextNeedingAttention(items, id("new"))).toBe("old");
    expect(nextNeedingAttention(items, id("old"))).toBe("new");
    expect(nextNeedingAttention([], null)).toBeNull();
  });
});

describe("unreadMarker", () => {
  it("sits just before the last message", () => {
    const marked = chat("a", "2026-10-02T10:00:00.000Z", null);
    const marker = unreadMarker(marked);
    expect(marker).toBe("2026-10-02T09:59:59.999Z");
    expect(isUnread({ ...marked, myState: { lastReadAt: marker } })).toBe(true);
    expect(unreadMarker(chat("b", null, null))).toBeNull();
  });
});
