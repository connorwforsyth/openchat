import type { ConversationId } from "@workspace/contract/schemas/common";
import {
  type ConversationEvent,
  conversationEventSchema,
} from "@workspace/contract/schemas/conversations";

import { sseEvents } from "./run-stream";

// Follows a conversation's live channel (`GET /api/conversations/{id}/events`,
// contract README "The conversation events") for as long as the chat is
// open. Events are hints with no resume, so after a dropped connection it
// reconnects and calls `onOpen` again: the caller refetches what it shows.

export interface ConversationEventsOptions {
  /** Origin of the server; `""` for same origin. */
  readonly baseUrl?: string;
  readonly fetch?: typeof fetch;
  readonly onEvent: (event: ConversationEvent) => void;
  /** Each time the stream (re)connects; refetch here after the first. */
  readonly onOpen?: (reconnected: boolean) => void;
  /** Delay before reconnect attempt `n` (from 1). */
  readonly retryDelayMs?: (attempt: number) => number;
  readonly signal: AbortSignal;
}

const defaultDelay = (attempt: number) =>
  Math.min(500 * 2 ** (attempt - 1), 15_000);

/** The server said no for good: signed out, or no access to the chat. */
const FATAL = (status: number) => status >= 400 && status < 500;

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
  });

/** One event's `data`, or `null` when it isn't an event this build reads. */
const parseEvent = (data: string): ConversationEvent | null => {
  try {
    const parsed = conversationEventSchema.safeParse(JSON.parse(data));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

/**
 * Reads the conversation's events until `signal` aborts or the server
 * refuses (4xx). Resolves then; never rejects.
 */
export const followConversationEvents = async (
  conversationId: ConversationId,
  {
    baseUrl = "",
    fetch: fetchImpl = globalThis.fetch,
    onEvent,
    onOpen,
    retryDelayMs = defaultDelay,
    signal,
  }: ConversationEventsOptions
): Promise<void> => {
  let opened = false;
  let failures = 0;
  while (!signal.aborted) {
    try {
      // biome-ignore lint/performance/noAwaitInLoops: one connection at a time.
      const response = await fetchImpl(
        `${baseUrl}/api/conversations/${conversationId}/events`,
        {
          credentials: "include",
          headers: { accept: "text/event-stream" },
          signal,
        }
      );
      if (FATAL(response.status)) {
        return;
      }
      const reader = response.ok ? response.body?.getReader() : undefined;
      if (reader) {
        onOpen?.(opened);
        opened = true;
        failures = 0;
        for await (const { data } of sseEvents(reader)) {
          const event = parseEvent(data);
          if (event) {
            onEvent(event);
          }
        }
      }
    } catch {
      // A dropped connection or an abort; the loop decides which.
    }
    if (signal.aborted) {
      return;
    }
    failures += 1;
    await wait(retryDelayMs(failures), signal);
  }
};
