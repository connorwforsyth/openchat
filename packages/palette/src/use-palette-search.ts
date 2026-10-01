"use client";

import type { SearchHit } from "@workspace/contract/schemas/search";
import { useEffect, useState } from "react";

import {
  type ChatResult,
  mergeChatResults,
  searchCachedChats,
  staleHitsFor,
} from "./chats";
import type { CachedChat } from "./items";

// Local first, server second (D28): cached chats rank synchronously on every
// keystroke; the server's full-text search runs once typing pauses and its
// hits merge in below. Nothing clears between keystrokes (ticket 100): while
// the next search runs, the last answer's hits stay, filtered and re-ranked
// for the new text, and a response for a query that moved on is dropped.

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
  /** How long a search runs before `showSearching` turns on. */
  readonly slowMs?: number;
}

interface ServerState {
  readonly hits: readonly SearchHit[];
  /** The query `hits` answer. */
  readonly query: string;
  readonly status: ServerSearchStatus;
}

const IDLE: ServerState = { hits: [], query: "", status: "idle" };

/** The hits to show for `query`: the server's own answer, else the last one's that still match. */
const hitsFor = (query: string, state: ServerState): readonly SearchHit[] =>
  state.query === query ? state.hits : staleHitsFor(query, state.hits);

export const usePaletteSearch = ({
  cachedChats,
  debounceMs = 150,
  minServerQueryLength = 2,
  query,
  searchChats,
  slowMs = 300,
}: UsePaletteSearchOptions): {
  readonly chats: readonly ChatResult[];
  readonly serverStatus: ServerSearchStatus;
  /** A search has run for `slowMs`: worth a quiet spinner, never a placeholder row. */
  readonly showSearching: boolean;
} => {
  const trimmed = query.trim();
  const [server, setServer] = useState<ServerState>(IDLE);
  const [slow, setSlow] = useState(false);
  const cached = searchCachedChats(trimmed, cachedChats());

  useEffect(() => {
    if (trimmed.length === 0) {
      setServer(IDLE);
      setSlow(false);
      return;
    }
    if (!searchChats || trimmed.length < minServerQueryLength) {
      // Too short to ask the server; the hits already here still filter.
      setServer((previous) => ({ ...previous, status: "idle" }));
      setSlow(false);
      return;
    }
    const controller = new AbortController();
    const settle = (next: (previous: ServerState) => ServerState) => {
      if (!controller.signal.aborted) {
        setServer(next);
        setSlow(false);
      }
    };
    setServer((previous) => ({ ...previous, status: "searching" }));
    // Not reset in the cleanup: typing on through a slow search keeps the
    // spinner steady instead of blinking it off and on per key.
    const slowTimer = setTimeout(() => setSlow(true), slowMs);
    const timer = setTimeout(() => {
      searchChats(trimmed, controller.signal).then(
        (found) =>
          settle(() => ({ hits: found, query: trimmed, status: "done" })),
        // Offline or the server is down: what's listed still stands.
        () =>
          settle((previous) => ({
            hits: hitsFor(trimmed, previous),
            query: trimmed,
            status: "failed",
          }))
      );
    }, debounceMs);
    return () => {
      clearTimeout(slowTimer);
      clearTimeout(timer);
      controller.abort();
    };
  }, [debounceMs, minServerQueryLength, searchChats, slowMs, trimmed]);

  const serverStatus =
    trimmed.length < minServerQueryLength ? "idle" : server.status;
  return {
    chats: mergeChatResults(cached, hitsFor(trimmed, server)),
    serverStatus,
    showSearching: slow && serverStatus === "searching",
  };
};
