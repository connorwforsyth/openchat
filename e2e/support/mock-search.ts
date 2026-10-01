import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

// A stand-in for SearXNG, the free self-hosted `web_search` backend (D23):
// `GET /search?format=json&q=…` answers two results made from the query, so
// a spec can tell what was searched for and that the results reached the
// model. The app reaches it through its ordinary `searxng` backend; nothing
// ever goes to a real search engine.

const NOT_A_WORD = /[^a-z0-9]+/g;
const EDGE_DASHES = /^-+|-+$/g;

interface MockResult {
  readonly content: string;
  readonly title: string;
  readonly url: string;
}

/** The results for a query, as the specs expect to see them cited. */
export const mockResults = (
  query: string
): readonly [MockResult, MockResult] => {
  const slug = query
    .toLowerCase()
    .replace(NOT_A_WORD, "-")
    .replace(EDGE_DASHES, "");
  return [
    {
      content: `Everything the mock index knows about ${query}.`,
      title: `Field guide: ${query}`,
      url: `https://search.e2e.test/guide/${slug}`,
    },
    {
      content: `More about ${query}.`,
      title: `Notes on ${query}`,
      url: `https://search.e2e.test/notes/${slug}`,
    },
  ];
};

export interface MockSearch {
  readonly close: () => Promise<void>;
  /** What app.config.yaml's `search.searxng.url` points at. */
  readonly url: string;
}

export const startMockSearch = async (port = 0): Promise<MockSearch> => {
  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://mock");
    if (request.method !== "GET" || url.pathname !== "/search") {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({ results: mockResults(url.searchParams.get("q") ?? "") })
    );
  });
  await new Promise<void>((resolve) => {
    server.listen(port, "127.0.0.1", resolve);
  });
  const { port: bound } = server.address() as AddressInfo;
  return {
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
    url: `http://127.0.0.1:${bound}`,
  };
};
