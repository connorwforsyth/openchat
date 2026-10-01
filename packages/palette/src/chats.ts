import type { ConversationId } from "@workspace/contract/schemas/common";
import type { SearchHit } from "@workspace/contract/schemas/search";

import type { CachedChat } from "./items";
import { foldText, rankEntries, scoreEntry } from "./rank";

// ⌘K chat search (D28): cached conversations answer on the first keystroke;
// the server's full-text results (titles and message bodies) arrive later and
// are merged in *below* them, so nothing the user is looking at moves.

export interface ChatResult {
  readonly id: ConversationId;
  /** The matching message, when the hit came from a message body. */
  readonly messageId: SearchHit["messageId"];
  readonly snippet: Pick<SearchHit, "highlights" | "snippet"> | null;
  readonly source: "cache" | "server";
  readonly title: string | null;
  readonly updatedAt: string;
}

const byRecency = (a: CachedChat, b: CachedChat): number =>
  Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt);

/** Cached chats matching the query; the most recent ones when it's empty. Archived chats only when asked for by name. */
export const searchCachedChats = (
  query: string,
  chats: readonly CachedChat[],
  limit = 6
): readonly ChatResult[] => {
  const searching = query.trim().length > 0;
  const pool = chats
    .filter((chat) => searching || !chat.archived)
    .slice()
    .sort(byRecency)
    .map((chat) => ({ chat, title: chat.title ?? "" }));
  return rankEntries(query, pool, limit).map(({ chat }) => ({
    id: chat.id,
    messageId: null,
    snippet: null,
    source: "cache",
    title: chat.title,
    updatedAt: chat.updatedAt,
  }));
};

/**
 * Cached results first, in their order; then server hits for chats the cache
 * didn't find, best rank first, one per chat. A server hit on a chat already
 * listed only adds its message snippet.
 */
export const mergeChatResults = (
  cached: readonly ChatResult[],
  hits: readonly SearchHit[],
  limit = 8
): readonly ChatResult[] => {
  const bestHit = new Map<ConversationId, SearchHit>();
  for (const hit of hits) {
    const seen = bestHit.get(hit.conversationId);
    if (!seen || hit.rank > seen.rank) {
      bestHit.set(hit.conversationId, hit);
    }
  }
  const enriched = cached.map((result) => {
    const hit = bestHit.get(result.id);
    return hit?.messageId
      ? {
          ...result,
          messageId: hit.messageId,
          snippet: { highlights: hit.highlights, snippet: hit.snippet },
        }
      : result;
  });
  const listed = new Set(cached.map((result) => result.id));
  const fromServer = [...bestHit.values()]
    .filter((hit) => !listed.has(hit.conversationId))
    .sort((a, b) => b.rank - a.rank)
    .map(
      (hit): ChatResult => ({
        id: hit.conversationId,
        messageId: hit.messageId,
        snippet: hit.messageId
          ? { highlights: hit.highlights, snippet: hit.snippet }
          : null,
        source: "server",
        title: hit.title,
        updatedAt: hit.updatedAt,
      })
    );
  return [...enriched, ...fromServer].slice(0, Math.max(limit, cached.length));
};

const WORD = /[\p{L}\p{N}]+/gu;
const WHITESPACE = /\s+/u;

/**
 * Server hits from an earlier query, kept while the next search runs so the
 * list doesn't empty on every keystroke (ticket 100). A hit stays only if
 * every word typed still starts a word of its title or snippet (the last
 * word as a prefix, like the server reads it; `-word` is skipped), and the
 * survivors are re-ranked by how well they answer the new text.
 */
export const staleHitsFor = (
  query: string,
  hits: readonly SearchHit[]
): readonly SearchHit[] => {
  const terms = foldText(query)
    .split(WHITESPACE)
    .filter((term) => term.length > 0 && !term.startsWith("-"))
    .flatMap((term) => term.match(WORD) ?? []);
  if (terms.length === 0) {
    return [];
  }
  return hits
    .map((hit) => {
      const text = `${hit.title ?? ""} ${hit.snippet}`;
      const words = foldText(text).match(WORD) ?? [];
      const matches = terms.every((term) =>
        words.some((word) => word.startsWith(term))
      );
      return {
        hit,
        // Words can match across title and snippet, which `scoreEntry` (one
        // field at a time) may score 0; such a hit still matches.
        score: matches
          ? 0.01 +
            scoreEntry(query, { subtitle: hit.snippet, title: hit.title ?? "" })
          : 0,
      };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || b.hit.rank - a.hit.rank)
    .map(({ hit, score }) => ({ ...hit, rank: score }));
};
