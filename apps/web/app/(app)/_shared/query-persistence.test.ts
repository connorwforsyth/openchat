import { QueryClient, QueryObserver } from "@tanstack/react-query";
import {
  type PersistedClient,
  type Persister,
  persistQueryClientRestore,
} from "@tanstack/react-query-persist-client";
import { describe, expect, it, vi } from "vitest";

import {
  gatePersister,
  pickPersisted,
  RECENT_CONVERSATIONS,
} from "./query-persistence";

type Query = PersistedClient["clientState"]["queries"][number];

const query = (
  queryKey: readonly unknown[],
  {
    status = "success",
    updatedAt = 0,
  }: { status?: string; updatedAt?: number } = {}
): Query =>
  ({
    queryHash: JSON.stringify(queryKey),
    queryKey,
    state: {
      data: { items: [] },
      dataUpdateCount: 1,
      dataUpdatedAt: updatedAt,
      error: null,
      errorUpdateCount: 0,
      errorUpdatedAt: 0,
      fetchFailureCount: 0,
      fetchFailureReason: null,
      fetchMeta: null,
      fetchStatus: "idle",
      isInvalidated: false,
      status,
    },
  }) as unknown as Query;

const client = (queries: Query[]): PersistedClient => ({
  buster: "user",
  clientState: { mutations: [], queries },
  timestamp: 0,
});

const keys = (persisted: PersistedClient) =>
  persisted.clientState.queries.map((each) => each.queryHash);

const path = (conversationId: string) => [
  ["messages", "path"],
  { input: { conversationId }, type: "query" },
];

describe("pickPersisted", () => {
  it("keeps the sidebar, library and who's signed in", () => {
    const kept = [
      query([
        ["conversations", "list"],
        { input: { limit: 100 }, type: "query" },
      ]),
      query([["me", "get"], { type: "query" }]),
      query(["library", "list", { tab: "mine" }]),
    ];
    const dropped = [
      query([["memory", "get"], { type: "query" }]),
      query([["keys", "list"], { type: "query" }]),
      query([["search", "conversations"], { type: "query" }]),
    ];
    expect(keys(pickPersisted(client([...kept, ...dropped])))).toEqual(
      keys(client(kept))
    );
  });

  it("drops queries that haven't succeeded", () => {
    const failed = query([["me", "get"], { type: "query" }], {
      status: "error",
    });
    expect(keys(pickPersisted(client([failed])))).toEqual([]);
  });

  it("keeps messages only for the most recently loaded conversations", () => {
    const conversations = Array.from(
      { length: RECENT_CONVERSATIONS + 2 },
      (_, index) => `c${index}`
    );
    const paths = conversations.map((id, index) =>
      query(path(id), { updatedAt: index })
    );
    const oldestTree = query([
      ["messages", "tree"],
      { input: { conversationId: "c0" }, type: "query" },
    ]);
    const newestChat = query([
      ["conversations", "get"],
      { input: { id: conversations.at(-1) }, type: "query" },
    ]);
    const persisted = keys(
      pickPersisted(client([...paths, oldestTree, newestChat]))
    );
    const newest = conversations.slice(-RECENT_CONVERSATIONS);
    expect(persisted).toEqual([
      ...newest.map((id) => JSON.stringify(path(id))),
      newestChat.queryHash,
    ]);
  });

  it("restores every query as stale, so a reload refetches what the snapshot missed", async () => {
    // The snapshot is written a second behind the cache and not at all on
    // unload, so one only a second old can still lack a new chat's title.
    const sidebar = [
      ["conversations", "list"],
      { input: { archived: false, limit: 100 }, type: "query" },
    ];
    const updatedAt = Date.now() - 1000;
    const snapshot = pickPersisted({
      ...client([
        query(sidebar, { updatedAt }),
        query(path("c1"), { updatedAt }),
      ]),
      timestamp: updatedAt,
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { staleTime: 30_000 } },
    });
    await persistQueryClientRestore({
      buster: "user",
      persister: {
        persistClient: () => undefined,
        removeClient: () => undefined,
        restoreClient: () => snapshot,
      },
      queryClient,
    });

    const fetched: string[] = [];
    const observers = [sidebar, path("c1")].map((queryKey) =>
      new QueryObserver(queryClient, {
        queryFn: () => {
          fetched.push(JSON.stringify(queryKey));
          return { items: [] };
        },
        queryKey,
      }).subscribe(() => undefined)
    );
    await vi.waitFor(() =>
      expect(fetched.sort()).toEqual(
        [JSON.stringify(sidebar), JSON.stringify(path("c1"))].sort()
      )
    );
    for (const unsubscribe of observers) {
      unsubscribe();
    }
  });

  it("never keeps mutations", () => {
    const persisted = pickPersisted({
      ...client([]),
      clientState: { mutations: [{} as never], queries: [] },
    });
    expect(persisted.clientState.mutations).toEqual([]);
  });
});

describe("gatePersister", () => {
  /** A persister over one in-memory slot. */
  const memoryPersister = () => {
    let slot: PersistedClient | undefined;
    const persister: Persister = {
      persistClient: (persisted) => {
        slot = persisted;
      },
      removeClient: () => {
        slot = undefined;
      },
      restoreClient: () => slot,
    };
    return { persister, stored: () => slot };
  };

  it("writes and restores while the policy allows it", async () => {
    const inner = memoryPersister();
    const gated = gatePersister(inner.persister, () => true);
    const persisted = client([query([["me", "get"], {}])]);
    await gated.persistClient(persisted);
    expect(await gated.restoreClient()).toBe(persisted);
  });

  it("keeps nothing on disk once an org turns persistence off", async () => {
    const inner = memoryPersister();
    let allowed = true;
    const gated = gatePersister(inner.persister, () => allowed);
    await gated.persistClient(client([query([["me", "get"], {}])]));
    expect(inner.stored()).toBeDefined();

    allowed = false;
    expect(await gated.restoreClient()).toBeUndefined();
    expect(inner.stored()).toBeUndefined();
    await gated.persistClient(client([query([["me", "get"], {}])]));
    expect(inner.stored()).toBeUndefined();
  });
});
