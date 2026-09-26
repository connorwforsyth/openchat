import { sourcePartSchema } from "@workspace/contract/schemas/message-parts";
import { webSearchResultSchema } from "@workspace/contract/schemas/search";
import { type Tool, tool } from "ai";
import { z } from "zod";

import type { SearchBackend } from "../ports/search-backend";
import { sourceId } from "../rag/sources";

// Our `web_search` tool (D23), for models without native search or when the
// admin turned native search off. The backend is a port; a failed search is
// a result the model reads ("search is unavailable"), not a failed run.

export const webSearchToolInputSchema = z.object({
  limit: z
    .int()
    .min(1)
    .max(10)
    .default(5)
    .describe("How many results to return."),
  query: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .describe("A web search query, as you'd type it into a search engine."),
});

export const webSearchToolOutputSchema = z.discriminatedUnion("status", [
  z.object({
    results: z.array(webSearchResultSchema.extend({ sourceId: z.string() })),
    sources: z.array(sourcePartSchema),
    status: z.literal("ok"),
  }),
  z.object({ message: z.string(), status: z.literal("unavailable") }),
]);
export type WebSearchToolOutput = z.infer<typeof webSearchToolOutputSchema>;

export interface WebSearchToolOptions {
  readonly backend: SearchBackend;
  /** The user's locale, as a BCP 47 tag. */
  readonly locale?: string;
  /** Instance or org policy; the model can't turn it off. */
  readonly safeSearch?: boolean;
}

const toModelText = (output: WebSearchToolOutput): string => {
  if (output.status === "unavailable") {
    return output.message;
  }
  if (output.results.length === 0) {
    return "The search returned no results.";
  }
  return output.results
    .map(
      (result, index) =>
        `[${index + 1}] ${result.title}\n${result.url}${result.publishedAt ? ` (${result.publishedAt.slice(0, 10)})` : ""}\n${result.snippet}`
    )
    .join("\n\n");
};

export const createWebSearchTool = ({
  backend,
  locale,
  safeSearch = true,
}: WebSearchToolOptions): Tool =>
  tool({
    description:
      "Search the web for current information. Cite results by their [number].",
    execute: async (
      input,
      { abortSignal, toolCallId }
    ): Promise<WebSearchToolOutput> => {
      const found = await backend.search(
        { limit: input.limit, locale, query: input.query, safeSearch },
        { signal: abortSignal }
      );
      if (!found.ok) {
        return {
          message:
            found.error.type === "rate_limited"
              ? "Web search is rate limited right now; answer without it or try again later."
              : "Web search is unavailable right now; answer without it.",
          status: "unavailable",
        };
      }
      const results = found.value.map((result, index) => ({
        ...result,
        sourceId: sourceId(toolCallId, index + 1),
      }));
      return {
        results,
        sources: results.map((result) => ({
          id: result.sourceId,
          source: {
            kind: "url" as const,
            title: result.title,
            url: result.url,
          },
          type: "source" as const,
        })),
        status: "ok",
      };
    },
    inputSchema: webSearchToolInputSchema,
    outputSchema: webSearchToolOutputSchema,
    toModelOutput: ({ output }) => ({
      type: "text",
      value: toModelText(output),
    }),
  });
