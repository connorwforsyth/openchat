import type {
  ConversationId,
  UserId,
} from "@workspace/contract/schemas/common";
import type { ConversationEvent } from "@workspace/contract/schemas/conversations";
import { describe, expect, it } from "vitest";

import { followConversationEvents } from "./conversation-events";

const CHAT = "0198d2a1-7c3e-7b40-8a00-000000000001" as ConversationId;
const ada = {
  email: null,
  id: "0198d2a1-7c3e-7b40-8a00-0000000000aa" as UserId,
  image: null,
  name: "Ada",
};

const sse = (...events: readonly unknown[]) =>
  new Response(
    events
      .map((event) =>
        typeof event === "string" ? event : `data: ${JSON.stringify(event)}\n\n`
      )
      .join(""),
    { headers: { "content-type": "text/event-stream" } }
  );

describe("followConversationEvents", () => {
  it("delivers parsed events, skips ones it can't read, and reconnects after a drop", async () => {
    const controller = new AbortController();
    const seen: ConversationEvent[] = [];
    const opens: boolean[] = [];
    const answers = [
      () =>
        sse(
          { type: "presence", users: [ada] },
          ": keep-alive\n\n",
          { type: "nonsense" },
          "data: not json\n\n",
          { type: "typing", user: ada }
        ),
      () => {
        controller.abort();
        return sse({ type: "presence", users: [] });
      },
    ];
    const urls: string[] = [];
    await followConversationEvents(CHAT, {
      fetch: (input) => {
        urls.push(String(input));
        const next = answers.shift();
        return Promise.resolve(next ? next() : new Response(null));
      },
      onEvent: (event) => seen.push(event),
      onOpen: (reconnected) => opens.push(reconnected),
      retryDelayMs: () => 0,
      signal: controller.signal,
    });
    expect(urls).toEqual([
      `/api/conversations/${CHAT}/events`,
      `/api/conversations/${CHAT}/events`,
    ]);
    expect(opens).toEqual([false, true]);
    expect(seen.slice(0, 2)).toEqual([
      { type: "presence", users: [ada] },
      { type: "typing", user: ada },
    ]);
  });

  it.each([408, 429])(
    "retries transient HTTP %i and delivers the next stream",
    async (status) => {
      const controller = new AbortController();
      const seen: ConversationEvent[] = [];
      let calls = 0;
      await followConversationEvents(CHAT, {
        fetch: () => {
          calls += 1;
          return Promise.resolve(
            calls === 1
              ? new Response(null, { status })
              : sse({ type: "typing", user: ada })
          );
        },
        onEvent: (event) => {
          seen.push(event);
          controller.abort();
        },
        retryDelayMs: () => 0,
        signal: controller.signal,
      });
      expect(calls).toBe(2);
      expect(seen).toEqual([{ type: "typing", user: ada }]);
    }
  );

  it("stops for good when the server refuses", async () => {
    let calls = 0;
    await followConversationEvents(CHAT, {
      fetch: () => {
        calls += 1;
        return Promise.resolve(new Response(null, { status: 404 }));
      },
      onEvent: () => undefined,
      retryDelayMs: () => 0,
      signal: new AbortController().signal,
    });
    expect(calls).toBe(1);
  });
});
