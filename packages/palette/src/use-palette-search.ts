"use client";

import type { SearchHit } from "@workspace/contract/schemas/search";
import { useEffect, useState } from "react";

import { type ChatResult, mergeChatResults, searchCachedChats } from "./chats";
import type { CachedChat } from "./items";

// Local first, server second (D28): cached chats rank synchronously on every
// keystroke; the server's full-text search runs once typing pauses and its
// hits merge in below. A stale response (the query moved on) is dropped.

export type SearchChats = (
  query: string,
  signal: AbortSignal
) => Promise<readonly SearchHit[]>;

export type ServerSearchStatus = "idle" | "searching" | "done" | "failed";

export interface UsePaletteSearchOptions {
  /** Reads the conversation cache; called on each keystroke, so keep it cheap. */
  readonly cachedChats: () => readonly CachedChat[];
  readonly debounceMs?: number;
  /** Shorter queries stay local: two letters match half of every title. */
  readonly minServerQueryLength?: number;
  readonly query: string;
  readonly searchChats?: SearchChats;
}

interface ServerState {
  readonly hits: readonly SearchHit[];
  readonly query: string;
  readonly status: ServerSearchStatus;
}

const IDLE: ServerState = { hits: [], query: "", status: "idle" };

export const usePaletteSearch = ({
  cachedChats,
  debounceMs = 150,
  minServerQueryLength = 2,
  query,
  searchChats,
}: UsePaletteSearchOptions): {
  readonly chats: readonly ChatResult[];
  readonly serverStatus: ServerSearchStatus;
} => {
  const trimmed = query.trim();
  const [server, setServer] = useState<ServerState>(IDLE);
  const cached = searchCachedChats(trimmed, cachedChats());

  useEffect(() => {
    if (!searchChats || trimmed.length < minServerQueryLength) {
      setServer(IDLE);
      return;
    }
    const controller = new AbortController();
    setServer((previous) => ({ ...previous, status: "searching" }));
    const timer = setTimeout(() => {
      searchChats(trimmed, controller.signal).then(
        (found) => setServer({ hits: found, query: trimmed, status: "done" }),
        () => {
          if (!controller.signal.aborted) {
            // Offline or the server is down: the cached results still stand.
            setServer({ hits: [], query: trimmed, status: "failed" });
          }
        }
      );
    }, debounceMs);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [debounceMs, minServerQueryLength, searchChats, trimmed]);

  const hits = server.query === trimmed ? server.hits : [];
  return {
    chats: mergeChatResults(cached, hits),
    serverStatus:
      trimmed.length < minServerQueryLength ? "idle" : server.status,
  };
};
