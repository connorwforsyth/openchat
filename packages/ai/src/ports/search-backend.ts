import type {
  WebSearchInput,
  WebSearchResult,
} from "@workspace/contract/schemas/search";
import type { AsyncResult } from "@workspace/shared/result";
import { z } from "zod";

// The SearchBackend port (D23): our `web_search` tool's backend when the
// model has no native search. Adapters: SearXNG (self-hosted, the compose
// profile), Brave, Tavily, Exa. Full-text search over chats is a database
// query, not this port.

export const searchBackendIdSchema = z.enum([
  "searxng",
  "brave",
  "tavily",
  "exa",
]);

export const searchBackendErrorSchema = z.discriminatedUnion("type", [
  /** Not configured, no key, or the service is down. The tool reports it; the run continues. */
  z.object({ message: z.string(), type: z.literal("unavailable") }),
  z.object({
    retryAfterSeconds: z.number().nullable(),
    type: z.literal("rate_limited"),
  }),
]);
export type SearchBackendError = z.infer<typeof searchBackendErrorSchema>;

export interface SearchBackend {
  /** Which backend, for logs and the tool's citation. */
  readonly id: string;
  /** Results best first, at most `input.limit`. An empty list is a success. */
  search: (
    input: WebSearchInput,
    options?: { readonly signal?: AbortSignal }
  ) => AsyncResult<readonly WebSearchResult[], SearchBackendError>;
}
