import { z } from "zod";

import {
  conversationIdSchema,
  messageIdSchema,
  pageInputSchema,
  timestampSchema,
} from "./common";
import { messageRoleSchema } from "./messages";
import { chatContextTypeSchema } from "./tenancy";

// Full-text search over the caller's chats (Postgres tsvector, D1/§7). Web
// search is a tool, not an API; its backend port is `SearchBackend` in
// `@workspace/ai/ports/search-backend`.

export const searchConversationsInputSchema = pageInputSchema.extend({
  archived: z.boolean().optional(),
  contextType: chatContextTypeSchema.optional(),
  query: z.string().trim().min(1).max(500),
});

/** A span of `snippet` to highlight, as UTF-16 offsets (no HTML in results). */
export const highlightSchema = z.object({
  end: z.int().min(0),
  start: z.int().min(0),
});

export const searchHitSchema = z.object({
  conversationId: conversationIdSchema,
  highlights: z.array(highlightSchema),
  /** `null` when the title matched. */
  messageId: messageIdSchema.nullable(),
  rank: z.number(),
  role: messageRoleSchema.nullable(),
  snippet: z.string(),
  title: z.string().nullable(),
  updatedAt: timestampSchema,
});
export type SearchHit = z.infer<typeof searchHitSchema>;

/** A web search result, as the `web_search` tool and `SearchBackend` return it. */
export const webSearchResultSchema = z.object({
  publishedAt: timestampSchema.nullable(),
  snippet: z.string(),
  title: z.string(),
  url: z.url(),
});
export type WebSearchResult = z.infer<typeof webSearchResultSchema>;

export const webSearchInputSchema = z.object({
  limit: z.int().min(1).max(20).default(8),
  /** A BCP 47 tag, from the user's locale. */
  locale: z.string().max(35).optional(),
  query: z.string().trim().min(1).max(500),
  safeSearch: z.boolean().default(true),
});
export type WebSearchInput = z.infer<typeof webSearchInputSchema>;
