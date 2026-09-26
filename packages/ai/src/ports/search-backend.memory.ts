import type { WebSearchResult } from "@workspace/contract/schemas/search";
import { ok } from "@workspace/shared/result";

import type { SearchBackend } from "./search-backend";

// An in-memory SearchBackend over fixed documents: ranks by how many query
// words appear in the title or snippet. Records queries for assertions.

const words = (text: string) =>
  text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

export interface MemorySearchBackend extends SearchBackend {
  readonly queries: readonly string[];
}

export const createMemorySearchBackend = (
  documents: readonly WebSearchResult[]
): MemorySearchBackend => {
  const queries: string[] = [];
  return {
    id: "memory",
    queries,
    search: (input) => {
      queries.push(input.query);
      const terms = new Set(words(input.query));
      const ranked = documents
        .map((document, index) => ({
          document,
          index,
          score: words(`${document.title} ${document.snippet}`).filter((w) =>
            terms.has(w)
          ).length,
        }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score || a.index - b.index)
        .slice(0, input.limit)
        .map(({ document }) => document);
      return Promise.resolve(ok(ranked));
    },
  };
};
