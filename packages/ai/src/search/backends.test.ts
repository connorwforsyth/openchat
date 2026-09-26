import { appConfigSchema } from "@workspace/config/schema";
import { webSearchResultSchema } from "@workspace/contract/schemas/search";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  BRAVE_URL,
  createBraveBackend,
  createExaBackend,
  createSearxngBackend,
  createTavilyBackend,
  EXA_URL,
  TAVILY_URL,
} from "./backends";
import { createSearchBackend } from "./from-config";

// Every backend against MSW: the request it sends, the results it parses,
// and how it fails. Nothing leaves the process (`onUnhandledRequest: error`).

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const TEST_KEY = "test-key-not-real";
const input = {
  limit: 2,
  locale: "en-GB",
  query: "pgvector hnsw",
  safeSearch: true,
};

describe("SearXNG", () => {
  const SEARXNG = "http://searxng.test:8080";

  it("asks for JSON and maps results, dropping non-web links", async () => {
    let seen: URL | undefined;
    server.use(
      http.get(`${SEARXNG}/search`, ({ request }) => {
        seen = new URL(request.url);
        return HttpResponse.json({
          results: [
            {
              content: "Indexes for <b>vectors</b>",
              publishedDate: "2025-01-02T00:00:00",
              title: "pgvector",
              url: "https://github.com/pgvector/pgvector",
            },
            { content: "x", title: "Local", url: "file:///etc/passwd" },
            { content: null, title: null, url: "https://example.org/b" },
            { content: "over limit", title: "C", url: "https://example.org/c" },
          ],
        });
      })
    );
    const result = await createSearxngBackend({ url: `${SEARXNG}/` }).search(
      input
    );
    expect(Object.fromEntries(seen?.searchParams ?? [])).toEqual({
      format: "json",
      language: "en",
      pageno: "1",
      q: "pgvector hnsw",
      safesearch: "1",
    });
    expect(result).toEqual({
      ok: true,
      value: [
        {
          publishedAt: new Date("2025-01-02T00:00:00").toISOString(),
          snippet: "Indexes for vectors",
          title: "pgvector",
          url: "https://github.com/pgvector/pgvector",
        },
        {
          publishedAt: null,
          snippet: "",
          title: "https://example.org/b",
          url: "https://example.org/b",
        },
      ],
    });
    for (const item of result.ok ? result.value : []) {
      expect(webSearchResultSchema.parse(item)).toEqual(item);
    }
  });

  it("reports a disabled JSON format, a crash or a dead host as unavailable", async () => {
    const backend = createSearxngBackend({ url: SEARXNG });
    server.use(
      http.get(
        `${SEARXNG}/search`,
        () => new HttpResponse(null, { status: 403 })
      )
    );
    expect(await backend.search(input)).toEqual({
      error: { message: "SearXNG answered 403.", type: "unavailable" },
      ok: false,
    });
    server.use(
      http.get(`${SEARXNG}/search`, () => HttpResponse.text("<html>"))
    );
    expect(await backend.search(input)).toMatchObject({
      error: { type: "unavailable" },
    });
    server.use(http.get(`${SEARXNG}/search`, () => HttpResponse.error()));
    expect(await backend.search(input)).toEqual({
      error: { message: "SearXNG couldn't be reached.", type: "unavailable" },
      ok: false,
    });
  });
});

describe("Brave", () => {
  it("sends the key as a header and maps web results", async () => {
    server.use(
      http.get(BRAVE_URL, ({ request }) => {
        const url = new URL(request.url);
        expect(request.headers.get("x-subscription-token")).toBe(TEST_KEY);
        expect(url.searchParams.get("safesearch")).toBe("strict");
        expect(url.searchParams.get("count")).toBe("2");
        return HttpResponse.json({
          web: {
            results: [
              {
                description: "The <strong>fast</strong> one",
                page_age: "2024-06-01T10:00:00Z",
                title: "HNSW",
                url: "https://example.org/hnsw",
              },
            ],
          },
        });
      })
    );
    const result = await createBraveBackend({ apiKey: TEST_KEY }).search(input);
    expect(result).toEqual({
      ok: true,
      value: [
        {
          publishedAt: "2024-06-01T10:00:00.000Z",
          snippet: "The fast one",
          title: "HNSW",
          url: "https://example.org/hnsw",
        },
      ],
    });
  });

  it("passes rate limiting through with its retry hint", async () => {
    server.use(
      http.get(
        BRAVE_URL,
        () =>
          new HttpResponse(null, {
            headers: { "retry-after": "30" },
            status: 429,
          })
      )
    );
    expect(
      await createBraveBackend({ apiKey: TEST_KEY }).search(input)
    ).toEqual({
      error: { retryAfterSeconds: 30, type: "rate_limited" },
      ok: false,
    });
  });

  it("tolerates a response without web results", async () => {
    server.use(http.get(BRAVE_URL, () => HttpResponse.json({})));
    expect(
      await createBraveBackend({ apiKey: TEST_KEY }).search(input)
    ).toEqual({ ok: true, value: [] });
  });
});

describe("Tavily", () => {
  it("posts the query with a bearer key", async () => {
    server.use(
      http.post(TAVILY_URL, async ({ request }) => {
        expect(request.headers.get("authorization")).toBe(`Bearer ${TEST_KEY}`);
        expect(await request.json()).toMatchObject({
          max_results: 2,
          query: "pgvector hnsw",
        });
        return HttpResponse.json({
          results: [
            {
              content: "Tavily snippet",
              title: "T",
              url: "https://example.org/t",
            },
          ],
        });
      })
    );
    expect(
      await createTavilyBackend({ apiKey: TEST_KEY }).search(input)
    ).toEqual({
      ok: true,
      value: [
        {
          publishedAt: null,
          snippet: "Tavily snippet",
          title: "T",
          url: "https://example.org/t",
        },
      ],
    });
  });
});

describe("Exa", () => {
  it("uses highlights as the snippet", async () => {
    server.use(
      http.post(EXA_URL, async ({ request }) => {
        expect(request.headers.get("x-api-key")).toBe(TEST_KEY);
        expect(await request.json()).toMatchObject({ numResults: 2 });
        return HttpResponse.json({
          results: [
            {
              highlights: ["First.", "Second."],
              publishedDate: "2023-03-04",
              title: "E",
              url: "https://example.org/e",
            },
          ],
        });
      })
    );
    expect(await createExaBackend({ apiKey: TEST_KEY }).search(input)).toEqual({
      ok: true,
      value: [
        {
          publishedAt: "2023-03-04T00:00:00.000Z",
          snippet: "First. … Second.",
          title: "E",
          url: "https://example.org/e",
        },
      ],
    });
  });
});

describe("createSearchBackend", () => {
  const config = (search: object = {}) => appConfigSchema.parse({ search });

  it("has no backend on an empty config and environment", () => {
    expect(createSearchBackend(config(), { env: {} })).toMatchObject({
      error: { backend: "none" },
      ok: false,
    });
  });

  it("defaults to SearXNG when its URL is in the environment", () => {
    const backend = createSearchBackend(config(), {
      env: { SEARXNG_URL: "http://localhost:8080" },
    });
    expect(backend.ok && backend.value.id).toBe("searxng");
  });

  it("makes a keyless paid backend unavailable instead of crashing", () => {
    expect(
      createSearchBackend(config({ backend: "brave", brave: {} }), { env: {} })
    ).toEqual({
      error: {
        backend: "brave",
        message:
          'web search backend "brave" has no API key (search.brave.apiKey or BRAVE_API_KEY)',
      },
      ok: false,
    });
    const fromEnv = createSearchBackend(config({ backend: "exa", exa: {} }), {
      env: { EXA_API_KEY: TEST_KEY },
    });
    expect(fromEnv.ok && fromEnv.value.id).toBe("exa");
    const fromYaml = createSearchBackend(
      config({ backend: "tavily", tavily: { apiKey: TEST_KEY } }),
      { env: {} }
    );
    expect(fromYaml.ok && fromYaml.value.id).toBe("tavily");
  });

  it("uses the configured SearXNG URL over the environment", async () => {
    server.use(
      http.get("http://configured.test/search", () =>
        HttpResponse.json({ results: [] })
      )
    );
    const backend = createSearchBackend(
      config({
        backend: "searxng",
        searxng: { url: "http://configured.test" },
      }),
      { env: { SEARXNG_URL: "http://other.test" } }
    );
    expect(backend.ok && (await backend.value.search(input))).toEqual({
      ok: true,
      value: [],
    });
  });
});
