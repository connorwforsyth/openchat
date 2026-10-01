import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { fixtureId, fixtureTime } from "@workspace/contract/fixtures";
import type { SearchHit } from "@workspace/contract/schemas/search";
import { afterEach, describe, expect, it } from "vitest";

import type { CachedChat } from "./items";
import { type SearchChats, usePaletteSearch } from "./use-palette-search";

const hit = (n: number, snippet: string): SearchHit => ({
  conversationId: fixtureId("conversation", n),
  highlights: [],
  messageId: fixtureId("message", n),
  rank: 1,
  role: "user",
  snippet,
  title: `Server chat ${n}`,
  updatedAt: fixtureTime(n),
});

const noCache = (): readonly CachedChat[] => [];

/** A server whose answers the test hands out, one pending search per query. */
const fakeServer = () => {
  const pending = new Map<string, (hits: readonly SearchHit[]) => void>();
  const failing = new Map<string, (reason: Error) => void>();
  const searchChats: SearchChats = (query) =>
    new Promise((resolve, reject) => {
      pending.set(query, resolve);
      failing.set(query, reject);
    });
  const answer = async (query: string, hits: readonly SearchHit[]) => {
    await waitFor(() => expect(pending.has(query)).toBe(true));
    await act(async () => {
      pending.get(query)?.(hits);
      await Promise.resolve();
    });
  };
  const fail = async (query: string) => {
    await waitFor(() => expect(failing.has(query)).toBe(true));
    await act(async () => {
      failing.get(query)?.(new Error("offline"));
      await Promise.resolve();
    });
  };
  return { answer, fail, pending, searchChats };
};

const renderSearch = (
  searchChats: SearchChats,
  options: { readonly slowMs?: number } = {}
) =>
  renderHook(
    ({ query }: { query: string }) =>
      usePaletteSearch({
        cachedChats: noCache,
        debounceMs: 0,
        query,
        searchChats,
        ...options,
      }),
    { initialProps: { query: "" } }
  );

const ids = (result: { current: ReturnType<typeof usePaletteSearch> }) =>
  result.current.chats.map((chat) => chat.id);

afterEach(() => {
  cleanup();
});

describe("usePaletteSearch", () => {
  it("keeps the last answer's matching hits while the next search runs", async () => {
    const server = fakeServer();
    const { rerender, result } = renderSearch(server.searchChats);
    const query = hit(1, "Query selection");
    const queue = hit(2, "the queue is full");

    rerender({ query: "que" });
    await server.answer("que", [query, queue]);
    expect(ids(result)).toEqual([
      fixtureId("conversation", 1),
      fixtureId("conversation", 2),
    ]);

    // Typed on: nothing clears while "quer" is in flight; "queue" no longer
    // matches the text, so it goes at once.
    rerender({ query: "quer" });
    expect(result.current.serverStatus).toBe("searching");
    expect(ids(result)).toEqual([fixtureId("conversation", 1)]);

    // A late answer for a query that moved on is dropped.
    await waitFor(() => expect(server.pending.has("quer")).toBe(true));
    rerender({ query: "query" });
    await server.answer("quer", [queue]);
    expect(ids(result)).toEqual([fixtureId("conversation", 1)]);

    await server.answer("query", [query]);
    expect(result.current.serverStatus).toBe("done");
    expect(ids(result)).toEqual([fixtureId("conversation", 1)]);

    // Nothing matches any more: gone without waiting for the server.
    rerender({ query: "queryx" });
    expect(ids(result)).toEqual([]);

    // Backspacing to one letter stays local but keeps what still matches.
    rerender({ query: "query" });
    await server.answer("query", [query]);
    rerender({ query: "q" });
    expect(result.current.serverStatus).toBe("idle");
    expect(ids(result)).toEqual([fixtureId("conversation", 1)]);

    // An empty query is the recent list: server hits go.
    rerender({ query: "" });
    expect(ids(result)).toEqual([]);
  });

  it("keeps what's listed when the server fails", async () => {
    const server = fakeServer();
    const { rerender, result } = renderSearch(server.searchChats);
    rerender({ query: "que" });
    await server.answer("que", [hit(1, "Query selection")]);
    rerender({ query: "quer" });
    await server.fail("quer");
    expect(result.current.serverStatus).toBe("failed");
    expect(ids(result)).toEqual([fixtureId("conversation", 1)]);
  });

  it("shows the searching indicator only once a search is slow", async () => {
    const server = fakeServer();
    const { rerender, result } = renderSearch(server.searchChats, {
      slowMs: 200,
    });
    rerender({ query: "que" });
    expect(result.current.serverStatus).toBe("searching");
    expect(result.current.showSearching).toBe(false);
    await waitFor(() => expect(result.current.showSearching).toBe(true));
    await server.answer("que", []);
    expect(result.current.showSearching).toBe(false);

    // A fast answer never shows it.
    rerender({ query: "quer" });
    await server.answer("quer", []);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(result.current.showSearching).toBe(false);
  });
});
