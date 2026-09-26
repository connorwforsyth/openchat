import { describe, expect, it } from "vitest";

import { createMemorySearchBackend } from "./search-backend.memory";

const doc = (title: string, snippet: string) => ({
  publishedAt: null,
  snippet,
  title,
  url: `https://example.test/${encodeURIComponent(title)}`,
});

describe("memory SearchBackend", () => {
  const backend = createMemorySearchBackend([
    doc("Hono streaming", "Server-sent events with streamSSE"),
    doc("Hono routing", "Routers and middleware"),
    doc("Cooking", "Pasta recipes"),
  ]);

  it("ranks by matching words and respects the limit", async () => {
    const result = await backend.search({
      limit: 1,
      query: "hono sse streaming",
      safeSearch: true,
    });
    expect(result.ok && result.value.map((d) => d.title)).toEqual([
      "Hono streaming",
    ]);
  });

  it("keeps input order for ties and drops non-matches", async () => {
    const result = await backend.search({
      limit: 8,
      query: "hono",
      safeSearch: true,
    });
    expect(result.ok && result.value.map((d) => d.title)).toEqual([
      "Hono streaming",
      "Hono routing",
    ]);
  });

  it("returns an empty list for no match and records queries", async () => {
    const result = await backend.search({
      limit: 8,
      query: "quantum",
      safeSearch: true,
    });
    expect(result).toEqual({ ok: true, value: [] });
    expect(backend.queries).toContain("quantum");
  });
});
