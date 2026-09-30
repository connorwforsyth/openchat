import type {
  PersistedClient,
  Persister,
} from "@tanstack/react-query-persist-client";
import { del, get, set } from "idb-keyval";

// D28: the query cache behind the sidebar, the library and the last few open
// conversations lives in IndexedDB, so a reload renders from it at once and
// revalidates in the background. Only that slice is kept: other queries are
// cheap to refetch or too personal to leave on disk for no gain. Sign-out
// removes it (`clearPersistedQueries`).

/** The IndexedDB key (idb-keyval's default store). */
export const PERSISTED_QUERIES_KEY = "query-cache";

/** Older than this and a restored cache is dropped rather than shown. */
export const PERSIST_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Conversations whose messages are kept, most recently loaded first. */
export const RECENT_CONVERSATIONS = 5;

/** Writes are batched: the cache changes on every fetch. */
const WRITE_DELAY_MS = 1000;

type DehydratedQuery = PersistedClient["clientState"]["queries"][number];

/**
 * A query's procedure path. oRPC keys start with the path array
 * (`[["conversations", "list"], {…}]`); the library screens use flat keys
 * (`["library", "list", filter]`).
 */
const pathOf = (key: readonly unknown[]): string => {
  const [head, second] = key;
  if (Array.isArray(head)) {
    return head.join(".");
  }
  return typeof head === "string" && typeof second === "string"
    ? `${head}.${second}`
    : "";
};

/** Always kept: what the first paint of any page needs. */
const SHELL_PATHS = new Set([
  "conversations.list",
  "library.list",
  "me.get",
  "meta.models",
]);

/** Kept for the most recently opened conversations only. */
const CONVERSATION_PATHS = new Set([
  "conversations.get",
  "messages.path",
  "messages.tree",
]);

/** The conversation a query is about, from its oRPC input. */
const conversationOf = (key: readonly unknown[]): string | null => {
  const [, options] = key;
  if (typeof options !== "object" || options === null) {
    return null;
  }
  const input = "input" in options ? options.input : null;
  if (typeof input !== "object" || input === null) {
    return null;
  }
  if ("conversationId" in input && typeof input.conversationId === "string") {
    return input.conversationId;
  }
  return "id" in input && typeof input.id === "string" ? input.id : null;
};

/**
 * The slice of a dehydrated cache worth keeping: settled shell queries, and
 * the stored messages of the few conversations opened last. Pure.
 */
export const pickPersisted = (client: PersistedClient): PersistedClient => {
  const settled = client.clientState.queries.filter(
    (query) => query.state.status === "success"
  );
  const recent = new Set(
    settled
      .filter((query) => pathOf(query.queryKey) === "messages.path")
      .sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt)
      .flatMap((query) => {
        const id = conversationOf(query.queryKey);
        return id ? [id] : [];
      })
      .filter((id, index, ids) => ids.indexOf(id) === index)
      .slice(0, RECENT_CONVERSATIONS)
  );
  const keep = (query: DehydratedQuery): boolean => {
    const path = pathOf(query.queryKey);
    if (SHELL_PATHS.has(path)) {
      return true;
    }
    if (!CONVERSATION_PATHS.has(path)) {
      return false;
    }
    const id = conversationOf(query.queryKey);
    return id !== null && recent.has(id);
  };
  return {
    ...client,
    clientState: {
      mutations: [],
      queries: settled.filter(keep).map(revalidated),
    },
  };
};

/**
 * A conversation's stored messages restore as stale, so they render at
 * once and refetch on mount. Restored with their fetch time they'd count as
 * fresh for `staleTime`, and a reload soon after activity would show an
 * answer as it was minutes ago: no approval card, "stopped early" on one
 * still running (072, audit F2). The shell's queries keep their age.
 */
const revalidated = (query: DehydratedQuery): DehydratedQuery =>
  CONVERSATION_PATHS.has(pathOf(query.queryKey))
    ? { ...query, state: { ...query.state, isInvalidated: true } }
    : query;

/**
 * An IndexedDB persister. Every storage call can fail (private windows,
 * blocked storage, quota); the app then simply boots without a warm cache.
 */
export const createIdbPersister = (
  key: string = PERSISTED_QUERIES_KEY
): Persister => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let latest: PersistedClient | undefined;
  return {
    persistClient: (client) => {
      latest = client;
      if (timer !== undefined) {
        return;
      }
      timer = setTimeout(() => {
        timer = undefined;
        if (latest) {
          set(key, pickPersisted(latest)).catch(() => undefined);
        }
      }, WRITE_DELAY_MS);
    },
    removeClient: async () => {
      clearTimeout(timer);
      timer = undefined;
      latest = undefined;
      await del(key).catch(() => undefined);
    },
    restoreClient: () => get<PersistedClient>(key).catch(() => undefined),
  };
};

/** Sign-out: nothing of the last user's stays on this machine. */
export const clearPersistedQueries = async (
  key: string = PERSISTED_QUERIES_KEY
): Promise<void> => {
  await del(key).catch(() => undefined);
};

/**
 * A persister that only touches disk while `allowed()` says so: the user's
 * `Me.persistClientCache`, off when an org they're in (or the instance)
 * turns persistence off for shared machines (D28, 042). Unknown counts as
 * no. Once it's off, what an earlier session stored is removed, not kept.
 */
export const gatePersister = (
  persister: Persister,
  allowed: () => boolean
): Persister => ({
  persistClient: (client) => {
    if (allowed()) {
      return persister.persistClient(client);
    }
    return persister.removeClient();
  },
  removeClient: () => persister.removeClient(),
  restoreClient: async () => {
    if (allowed()) {
      return persister.restoreClient();
    }
    await persister.removeClient();
  },
});
