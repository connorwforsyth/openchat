"use client";

import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { activeRunsInput } from "@workspace/chat-ui/chat/seed";
import type { ApiClient, QueryUtils } from "@workspace/client/api";
import type { ConversationId } from "@workspace/contract/schemas/common";
import {
  createContext,
  type ReactNode,
  useContext,
  useLayoutEffect,
  useState,
} from "react";

import { useApi } from "@/app/(app)/_shared/api";

// Ticket 103 (D27): the chat page reads what a chat's first paint needs on
// the server (`load-chat-seed.ts`) and hands it over as a promise, so the
// page streams. Two things take it from there:
//
// - the query cache: the chat's queries are started with the server's
//   answers as their fetch, so the browser never asks for them itself (and
//   asks as before when the server had nothing);
// - the chat screen, which renders the branch from it under a Suspense
//   boundary, so it's in the server's HTML without holding up the composer.
//
// The page is the one that knows the address, but the screen belongs to the
// layout (it outlives `/` → `/c/[id]`). The layout renders the page before
// the screen, so on the server and at hydration the page has filed its seed
// here by the time the screen looks for it.

export interface ChatSeed {
  readonly conversation: Awaited<ReturnType<ApiClient["conversations"]["get"]>>;
  readonly path: Awaited<ReturnType<ApiClient["messages"]["path"]>>;
  readonly runs: Awaited<ReturnType<ApiClient["runs"]["list"]>>;
}

export type ChatSeedPromise = Promise<ChatSeed | null>;

interface Seeds {
  readonly byChat: Map<ConversationId, ChatSeedPromise>;
  /** Seeds already started in the query cache, once each. */
  readonly started: WeakSet<ChatSeedPromise>;
}

const SeedsContext = createContext<Seeds | null>(null);

export function ChatSeedsProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const [seeds] = useState(
    (): Seeds => ({ byChat: new Map(), started: new WeakSet() })
  );
  return (
    <SeedsContext.Provider value={seeds}>{children}</SeedsContext.Provider>
  );
}

/** The seed the page filed for `conversationId`, if it filed one. */
export const useChatSeed = (
  conversationId: ConversationId | null | undefined
): ChatSeedPromise | undefined => {
  const seeds = useContext(SeedsContext);
  return conversationId ? seeds?.byChat.get(conversationId) : undefined;
};

/**
 * The seed as a real promise that never rejects. What the page streams is
 * React's thenable, whose `then` doesn't return a chained promise, so it's
 * adopted rather than chained on.
 */
const settled = (seed: ChatSeedPromise): Promise<ChatSeed | null> =>
  Promise.resolve(seed).catch(() => null);

/**
 * Starts the chat's queries with the server's answers as their fetch. A
 * query the screen mounts meanwhile joins that fetch instead of making its
 * own. A query that's still fresh in the cache (restored from IndexedDB, or
 * fetched a moment ago) isn't touched; with no seed, each one fetches as it
 * always did and meets the API's own checks.
 */
const startQueries = (
  queryClient: QueryClient,
  { client, query }: { readonly client: ApiClient; readonly query: QueryUtils },
  conversationId: ConversationId,
  seed: ChatSeedPromise
) => {
  const start = <T,>(
    queryKey: readonly unknown[],
    pick: (seeded: ChatSeed) => T,
    fetchItself: (signal: AbortSignal) => Promise<T>
  ) => {
    // The query keeps this function for its later refetches (an
    // invalidation refetches with the query's own options), so the seed
    // answers once and every fetch after it asks the API.
    let seeded: Promise<ChatSeed | null> | null = settled(seed);
    queryClient
      .prefetchQuery({
        queryFn: async ({ signal }) => {
          const first = seeded;
          seeded = null;
          const answer = first ? await first : null;
          return answer ? pick(answer) : fetchItself(signal);
        },
        queryKey,
      })
      .catch(() => undefined);
  };
  start(
    query.conversations.get.queryKey({ input: { id: conversationId } }),
    (seeded) => seeded.conversation,
    (signal) => client.conversations.get({ id: conversationId }, { signal })
  );
  start(
    query.messages.path.queryKey({ input: { conversationId } }),
    (seeded) => seeded.path,
    (signal) => client.messages.path({ conversationId }, { signal })
  );
  const runsInput = activeRunsInput(conversationId);
  start(
    query.runs.list.queryKey({ input: runsInput }),
    (seeded) => seeded.runs,
    (signal) => client.runs.list(runsInput, { signal })
  );
};

/**
 * Files the page's seed for the screen and starts the chat's queries from
 * it. Renders nothing. Filing happens during render, as the screen reads it
 * in the same pass. The queries start in a layout effect: after hydration,
 * so the screen hydrates against the same empty cache the server rendered
 * with (its rows come from the seed itself), and before any passive effect,
 * where the screen's queries would otherwise start their own fetch.
 */
export function ChatSeedFiler({
  conversationId,
  seed,
}: {
  readonly conversationId: ConversationId;
  readonly seed: ChatSeedPromise;
}) {
  const seeds = useContext(SeedsContext);
  const queryClient = useQueryClient();
  const api = useApi();
  seeds?.byChat.set(conversationId, seed);
  useLayoutEffect(() => {
    if (seeds && !seeds.started.has(seed)) {
      seeds.started.add(seed);
      startQueries(queryClient, api, conversationId, seed);
    }
  }, [api, conversationId, queryClient, seed, seeds]);
  return null;
}
