import type {
  ConversationId,
  UserId,
} from "@workspace/contract/schemas/common";
import { conversationIdSchema } from "@workspace/contract/schemas/common";
import {
  type ConversationEvent,
  conversationEventSchema,
} from "@workspace/contract/schemas/conversations";
import type { UserSummary } from "@workspace/contract/schemas/tenancy";
import type { Db } from "@workspace/db/client";
import { userSummaries } from "@workspace/db/queries/library-items";
import { sql } from "drizzle-orm";
import { z } from "zod";

import type { Listen } from "./listen";
import { SSE_HEADERS } from "./sse";

// A conversation's live channel (D25, contract README "The conversation
// events"). Messages and run status changes reach it from a trigger in the
// database (migration `conversation_events`), so every writer in every
// process is covered; typing goes through `publish`. Both arrive here as a
// NOTIFY on one channel, and each process hands them to its own open
// streams.
//
// Presence is the set of people with a stream open in this process. The
// web app is one process (D4); a second one would need presence shared
// through the database too.

export const CONVERSATION_EVENTS_CHANNEL = "conversation_events";

const notificationSchema = z.object({
  conversationId: conversationIdSchema,
  event: conversationEventSchema,
});

export interface ConversationEvents {
  /**
   * The conversation's events until `signal` aborts, starting with who is
   * present. `viewer` counts as present for as long as it's open.
   */
  readonly follow: (
    conversationId: ConversationId,
    viewer: UserSummary,
    signal: AbortSignal
  ) => AsyncIterable<ConversationEvent>;
  /** Sends an event to everyone following the conversation, in any process. */
  readonly publish: (
    conversationId: ConversationId,
    event: ConversationEvent
  ) => Promise<void>;
  /** Stops listening; open streams stay open but hear nothing more. */
  readonly stop: () => Promise<void>;
}

interface Follower {
  readonly push: (event: ConversationEvent) => void;
  readonly viewer: UserSummary;
}

/** Everyone in `followers`, once each, in the order they arrived. Pure. */
export const presentUsers = (
  followers: Iterable<{ readonly viewer: UserSummary }>
): UserSummary[] => [
  ...new Map(
    [...followers].map(({ viewer }) => [viewer.id, viewer] as const)
  ).values(),
];

export const createConversationEvents = ({
  db,
  listen,
}: {
  readonly db: Db;
  /** Without it nothing arrives but presence, which is local anyway. */
  readonly listen?: Listen;
}): ConversationEvents => {
  const rooms = new Map<ConversationId, Set<Follower>>();
  let listening: Promise<(() => Promise<void>) | null> | null = null;

  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const cancelRetry = () => {
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  };

  const deliver = (
    conversationId: ConversationId,
    event: ConversationEvent
  ) => {
    if (stopped) {
      return;
    }
    for (const follower of rooms.get(conversationId) ?? []) {
      follower.push(event);
    }
  };

  const announce = (conversationId: ConversationId) => {
    const room = rooms.get(conversationId);
    if (room) {
      deliver(conversationId, { type: "presence", users: presentUsers(room) });
    }
  };

  const ensureListening = () => {
    if (!listen || stopped || rooms.size === 0) {
      return;
    }
    listening ??= listen(CONVERSATION_EVENTS_CHANNEL, (payload) => {
      let json: unknown;
      try {
        json = JSON.parse(payload);
      } catch {
        return;
      }
      const parsed = notificationSchema.safeParse(json);
      if (parsed.success) {
        deliver(parsed.data.conversationId, parsed.data.event);
      }
    }).catch(() => {
      listening = null;
      if (!stopped && rooms.size > 0 && retryTimer === null) {
        retryTimer = setTimeout(() => {
          retryTimer = null;
          ensureListening();
        }, 1000);
      }
      return null;
    });
  };

  async function* follow(
    conversationId: ConversationId,
    viewer: UserSummary,
    signal: AbortSignal
  ): AsyncGenerator<ConversationEvent> {
    const queue: ConversationEvent[] = [];
    let wakeUp: (() => void) | null = null;
    const follower: Follower = {
      push: (event) => {
        queue.push(event);
        wakeUp?.();
      },
      viewer,
    };
    const room = rooms.get(conversationId) ?? new Set();
    room.add(follower);
    rooms.set(conversationId, room);
    ensureListening();
    const onAbort = () => wakeUp?.();
    signal.addEventListener("abort", onAbort, { once: true });
    announce(conversationId);
    try {
      while (!signal.aborted) {
        const next = queue.shift();
        if (next) {
          yield next;
          continue;
        }
        // biome-ignore lint/performance/noAwaitInLoops: waits for the next event, one at a time.
        await new Promise<void>((resolve) => {
          wakeUp = resolve;
        });
        wakeUp = null;
      }
    } finally {
      signal.removeEventListener("abort", onAbort);
      room.delete(follower);
      if (room.size === 0) {
        rooms.delete(conversationId);
        if (rooms.size === 0) {
          cancelRetry();
        }
      } else {
        announce(conversationId);
      }
    }
  }

  return {
    follow,
    publish: async (conversationId, event) => {
      await db.execute(
        sql`select pg_notify(${CONVERSATION_EVENTS_CHANNEL}, ${JSON.stringify({ conversationId, event })})`
      );
    },
    stop: async () => {
      stopped = true;
      cancelRetry();
      const unlisten = await listening;
      listening = null;
      await unlisten?.();
    },
  };
};

/**
 * At most one typing signal per person per chat in `windowMs`; the client
 * sends one every 2 seconds while someone types, and the window allows for
 * jitter. A dropped one costs nothing: the last one holds for
 * `TYPING_TTL_MS`.
 */
export const createTypingGate = (
  windowMs = 1500,
  now: () => number = Date.now
) => {
  const last = new Map<string, number>();
  return (userId: UserId, conversationId: ConversationId): boolean => {
    const at = now();
    const key = `${userId}:${conversationId}`;
    const previous = last.get(key);
    if (previous !== undefined && at - previous < windowMs) {
      return false;
    }
    last.set(key, at);
    if (last.size > 10_000) {
      for (const [stale, when] of last) {
        if (at - when >= windowMs) {
          last.delete(stale);
        }
      }
    }
    return true;
  };
};

/** The name and avatar others see for `userId`; `null` for a user that's gone. */
export const userSummaryOf = async (
  db: Db,
  userId: UserId
): Promise<UserSummary | null> => {
  const [found] = await userSummaries(db, [userId]);
  return found ?? null;
};

/**
 * Keeps idle proxies from closing a chat that's quiet, and is how often
 * access is checked again: a stream ends within this long of its grant
 * being taken away.
 */
const HEARTBEAT_MS = 15_000;

const encoder = new TextEncoder();

/**
 * `GET /api/conversations/{id}/events` as SSE, open until the client leaves
 * or `mayRead` says the viewer no longer may.
 */
export const conversationEventsResponse = (
  events: ConversationEvents,
  conversationId: ConversationId,
  viewer: UserSummary,
  request: Request,
  {
    heartbeatMs = HEARTBEAT_MS,
    mayRead,
  }: {
    readonly heartbeatMs?: number;
    /** Asked on every heartbeat; `false` ends the stream. */
    readonly mayRead: () => Promise<boolean>;
  }
): Response => {
  const controller = new AbortController();
  const abort = () => controller.abort();
  request.signal.addEventListener("abort", abort, { once: true });
  const iterator = events
    .follow(conversationId, viewer, controller.signal)
    [Symbol.asyncIterator]();
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const end = () => {
    clearInterval(heartbeat);
    request.signal.removeEventListener("abort", abort);
    controller.abort();
  };

  const body = new ReadableStream<Uint8Array>({
    cancel: () => {
      end();
      iterator.return?.().catch(() => undefined);
    },
    pull: async (sink) => {
      const next = await iterator.next();
      if (next.done) {
        end();
        sink.close();
        return;
      }
      sink.enqueue(encoder.encode(`data: ${JSON.stringify(next.value)}\n\n`));
    },
    start: (sink) => {
      heartbeat = setInterval(async () => {
        const allowed = await mayRead().catch(() => false);
        if (!allowed) {
          // Ends `follow`, so the next pull closes the stream.
          end();
          return;
        }
        try {
          sink.enqueue(encoder.encode(": keep-alive\n\n"));
        } catch {
          clearInterval(heartbeat);
        }
      }, heartbeatMs);
    },
  });

  const { "x-vercel-ai-ui-message-stream": _protocol, ...headers } =
    SSE_HEADERS;
  return new Response(body, { headers });
};
