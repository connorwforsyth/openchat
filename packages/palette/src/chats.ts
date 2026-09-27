import type { ConversationId } from "@workspace/contract/schemas/common";
import type { SearchHit } from "@workspace/contract/schemas/search";

import type { CachedChat } from "./items";
import { rankEntries } from "./rank";

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
