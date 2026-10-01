import type { ConversationId } from "@workspace/contract/schemas/common";
import { describe, expect, it } from "vitest";

import {
  type FirstSend,
  firstSendBusy,
  firstSendFailed,
  firstSendNext,
  firstSendQueued,
  firstSendStarted,
} from "./first-send";

// A new chat's first messages (134): one chat however many messages race
// to it, sent in order once the page is there, never one in place of
// another.

const made = "0192d3a8-0000-7000-8000-000000000001" as ConversationId;
const other = "0192d3a8-0000-7000-8000-000000000002" as ConversationId;

const idle = (conversationId: ConversationId | null) => ({
  conversationId,
  sending: false,
});

describe("first send", () => {
  it("keeps a message sent while the chat is made, after the first (the bug: it replaced it)", () => {
    // Both sends start before the chat exists; the second gets ready first
    // only if the caller lets it, so they're queued in the order they're ready.
    const creating = firstSendStarted<string>(firstSendStarted(null));
    const one = firstSendQueued(creating, made, "one");
    const both = firstSendQueued(one, made, "two");
    expect(both).toEqual({ conversationId: made, queue: ["one", "two"] });
  });

  it("sends nothing until the page shows the chat, then one at a time", () => {
    const both: FirstSend<string> = {
      conversationId: made,
      queue: ["one", "two"],
    };
    expect(firstSendNext(both, idle(null))).toBeNull();
    const first = firstSendNext(both, idle(made));
    expect(first).toEqual({
      item: "one",
      rest: { conversationId: made, queue: ["two"] },
    });
    // The second waits while the first is being answered.
    expect(
      firstSendNext(first?.rest ?? null, {
        conversationId: made,
        sending: true,
      })
    ).toBeNull();
    expect(firstSendNext(first?.rest ?? null, idle(made))).toEqual({
      item: "two",
      rest: null,
    });
  });

  it("sends nothing while the chat is still being made", () => {
    expect(firstSendNext(firstSendStarted(null), idle(null))).toBeNull();
  });

  it("keeps the composer busy from the send until the messages have gone", () => {
    expect(firstSendBusy(null, null)).toBe(false);
    const creating = firstSendStarted<string>(null);
    expect(firstSendBusy(creating, null)).toBe(true);
    const queued = firstSendQueued(creating, made, "one");
    // Made, but the page hasn't moved yet.
    expect(firstSendBusy(queued, null)).toBe(true);
    expect(firstSendBusy(queued, made)).toBe(true);
    // Not in another chat opened meanwhile.
    expect(firstSendBusy(queued, other)).toBe(false);
    expect(firstSendNext(queued, idle(made))?.rest).toBeNull();
  });

  it("frees the composer when the only message fails, and keeps ones already waiting", () => {
    expect(firstSendFailed(firstSendStarted(null))).toBeNull();
    const queued = firstSendQueued(firstSendStarted<string>(null), made, "one");
    expect(firstSendFailed(queued)).toBe(queued);
  });

  it("starts afresh when the person left an earlier new chat before its messages went", () => {
    const stale: FirstSend<string> = { conversationId: other, queue: ["old"] };
    expect(firstSendQueued(stale, made, "new")).toEqual({
      conversationId: made,
      queue: ["new"],
    });
  });
});
