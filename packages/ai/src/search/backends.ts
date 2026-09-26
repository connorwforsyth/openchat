import type { WebSearchResult } from "@workspace/contract/schemas/search";
import { ok } from "@workspace/shared/result";
import { z } from "zod";

import type { SearchBackend } from "../ports/search-backend";
import {
  type FetchFunction,
  isWebUrl,
  languageOf,
  plainText,
  requestJson,
  toTimestamp,
} from "./http";

// SearchBackend adapters (D23): SearXNG (self-hosted, free, the compose
// `search` profile), Brave, Tavily and Exa. Each is one HTTP call parsed
// with zod; anything unexpected is `unavailable`, which the `web_search`
// tool reports to the model instead of failing the run.

interface BackendOptions {
  readonly fetch?: FetchFunction;
}

const finish = (
  results: readonly (WebSearchResult | null)[],
  limit: number
): readonly WebSearchResult[] =>
  results
    .filter(
      (result): result is WebSearchResult =>
        result !== null && isWebUrl(result.url)
    )
    .slice(0, limit);

// --- SearXNG: GET /search?format=json (the instance must enable the json format) ---

const searxngResponseSchema = z.object({
  results: z.array(
    z.object({
      content: z.string().nullish(),
      publishedDate: z.string().nullish(),
      title: z.string().nullish(),
      url: z.string(),
    })
  ),
});

export const createSearxngBackend = ({
  fetch = globalThis.fetch,
  url,
}: BackendOptions & { readonly url: string }): SearchBackend => ({
  id: "searxng",
  search: async (input, { signal } = {}) => {
    const query = new URLSearchParams({
      format: "json",
      pageno: "1",
      q: input.query,
      safesearch: input.safeSearch ? "1" : "0",
    });
    const language = languageOf(input.locale);
    if (language) {
      query.set("language", language);
    }
    const base = url.endsWith("/") ? url.slice(0, -1) : url;
    const response = await requestJson(
      { fetch, label: "SearXNG", schema: searxngResponseSchema, signal },
      `${base}/search?${query}`,
      { headers: { accept: "application/json" }, method: "GET" }
    );
    if (!response.ok) {
      return response;
    }
    return ok(
      finish(
        response.value.results.map((result) => ({
          publishedAt: toTimestamp(result.publishedDate),
          snippet: plainText(result.content),
          title: plainText(result.title) || result.url,
          url: result.url,
        })),
        input.limit
      )
    );
  },
});

// --- Brave Search API: GET /res/v1/web/search ---

const braveResponseSchema = z.object({
  web: z
    .object({
      results: z.array(
        z.object({
          description: z.string().nullish(),
          page_age: z.string().nullish(),
          title: z.string().nullish(),
          url: z.string(),
        })
      ),
    })
    .nullish(),
});

export const BRAVE_URL = "https://api.search.brave.com/res/v1/web/search";

export const createBraveBackend = ({
  apiKey,
  fetch = globalThis.fetch,
}: BackendOptions & { readonly apiKey: string }): SearchBackend => ({
  id: "brave",
  search: async (input, { signal } = {}) => {
    const query = new URLSearchParams({
      count: String(input.limit),
      q: input.query,
      safesearch: input.safeSearch ? "strict" : "off",
    });
    const language = languageOf(input.locale);
    if (language) {
      query.set("search_lang", language);
    }
    const response = await requestJson(
      { fetch, label: "Brave Search", schema: braveResponseSchema, signal },
      `${BRAVE_URL}?${query}`,
      {
        headers: {
          accept: "application/json",
          "x-subscription-token": apiKey,
        },
        method: "GET",
      }
    );
    if (!response.ok) {
      return response;
    }
    return ok(
      finish(
        (response.value.web?.results ?? []).map((result) => ({
          publishedAt: toTimestamp(result.page_age),
          snippet: plainText(result.description),
          title: plainText(result.title) || result.url,
          url: result.url,
        })),
        input.limit
      )
    );
  },
});

// --- Tavily: POST /search ---

const tavilyResponseSchema = z.object({
  results: z.array(
    z.object({
      content: z.string().nullish(),
      published_date: z.string().nullish(),
      title: z.string().nullish(),
      url: z.string(),
    })
  ),
});

export const TAVILY_URL = "https://api.tavily.com/search";

export const createTavilyBackend = ({
  apiKey,
  fetch = globalThis.fetch,
}: BackendOptions & { readonly apiKey: string }): SearchBackend => ({
  id: "tavily",
  search: async (input, { signal } = {}) => {
    const response = await requestJson(
      { fetch, label: "Tavily", schema: tavilyResponseSchema, signal },
      TAVILY_URL,
      {
        body: JSON.stringify({
          include_answer: false,
          max_results: input.limit,
          query: input.query,
          search_depth: "basic",
        }),
        headers: {
          accept: "application/json",
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        method: "POST",
      }
    );
    if (!response.ok) {
      return response;
    }
    return ok(
      finish(
        response.value.results.map((result) => ({
          publishedAt: toTimestamp(result.published_date),
          snippet: plainText(result.content),
          title: plainText(result.title) || result.url,
          url: result.url,
        })),
        input.limit
      )
    );
  },
});

// --- Exa: POST /search, with highlights as snippets ---

const exaResponseSchema = z.object({
  results: z.array(
    z.object({
      highlights: z.array(z.string()).nullish(),
      publishedDate: z.string().nullish(),
      text: z.string().nullish(),
      title: z.string().nullish(),
      url: z.string(),
    })
  ),
});

export const EXA_URL = "https://api.exa.ai/search";

const SNIPPET_CHARS = 500;

export const createExaBackend = ({
  apiKey,
  fetch = globalThis.fetch,
}: BackendOptions & { readonly apiKey: string }): SearchBackend => ({
  id: "exa",
  search: async (input, { signal } = {}) => {
    const response = await requestJson(
      { fetch, label: "Exa", schema: exaResponseSchema, signal },
      EXA_URL,
      {
        body: JSON.stringify({
          contents: { highlights: { numSentences: 3 } },
          numResults: input.limit,
          query: input.query,
          type: "auto",
        }),
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-api-key": apiKey,
        },
        method: "POST",
      }
    );
    if (!response.ok) {
      return response;
    }
    return ok(
      finish(
        response.value.results.map((result) => ({
          publishedAt: toTimestamp(result.publishedDate),
          snippet: plainText(
            result.highlights?.join(" … ") ?? result.text
          ).slice(0, SNIPPET_CHARS),
          title: plainText(result.title) || result.url,
          url: result.url,
        })),
        input.limit
      )
    );
  },
});
