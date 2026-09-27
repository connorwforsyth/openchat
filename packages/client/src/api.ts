import { createORPCClient } from "@orpc/client";
import { BatchLinkPlugin } from "@orpc/client/plugins";
import type { ContractRouterClient } from "@orpc/contract";
import type { JsonifiedClient } from "@orpc/openapi-client";
import { OpenAPILink } from "@orpc/openapi-client/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { type Contract, contract } from "@workspace/contract/contract";

// The typed API client (D11, D26): every procedure in the contract, over the
// same REST routes the OpenAPI document describes, plus TanStack Query
// options with keys derived from the contract. The web app, the desktop
// renderer and scripts all use this; Swift uses the OpenAPI document.

export type ApiClient = JsonifiedClient<ContractRouterClient<Contract>>;

export interface ApiClientOptions {
  /** Origin of the server; `""` (same origin) in the web app. */
  readonly baseUrl?: string;
  /**
   * Send concurrent GETs as one request to {@link BATCH_PATH}. Defaults to on
   * with the global `fetch` and off with an injected one: injected fetches
   * are test fakes and scripts that answer by route, and a server without
   * `BatchHandlerPlugin` would 404 the batch route.
   */
  readonly batch?: boolean;
  /** For tests and non-browser runtimes. */
  readonly fetch?: typeof fetch;
  /** Extra headers per request (a bearer token on desktop). */
  readonly headers?: () =>
    | Record<string, string>
    | Promise<Record<string, string>>;
}

/**
 * Where batched requests go; the server's `BatchHandlerPlugin` answers any
 * request under `/api` that carries the `x-orpc-batch` header, so this only
 * has to reach the oRPC handler and not collide with a contract route.
 */
export const BATCH_PATH = "/api/__batch__";

const TRAILING_SLASH = /\/$/;

const origin = (baseUrl: string): string => {
  if (baseUrl) {
    return baseUrl.replace(TRAILING_SLASH, "");
  }
  return typeof window === "undefined"
    ? "http://localhost"
    : window.location.origin;
};

/**
 * Batches queries only (Q38: a chat fires a feedback GET per message).
 * Mutations stay one request each so a failure, retry or abort is about one
 * write; file uploads and streams are never batched (the plugin skips
 * `Blob`/`FormData`/iterator bodies, and the run stream isn't a procedure).
 * `buffered` mode answers with one JSON body rather than a stream, which
 * proxies and route handlers pass through without flushing concerns.
 */
const batchPlugin = (base: string) =>
  new BatchLinkPlugin({
    groups: [
      {
        condition: ({ request }) => request.method === "GET",
        context: {},
      },
    ],
    mode: "buffered",
    url: `${base}${BATCH_PATH}`,
  });

export const createApiClient = ({
  baseUrl = "",
  batch,
  fetch: fetchImpl,
  headers,
}: ApiClientOptions = {}): ApiClient => {
  const base = origin(baseUrl);
  return createORPCClient(
    new OpenAPILink(contract, {
      // Same-origin requests carry the session cookie, batched ones included:
      // the batch goes out through this same `fetch`.
      fetch: (request, init) =>
        (fetchImpl ?? globalThis.fetch)(request, {
          ...init,
          credentials: "include",
        }),
      headers: headers ? () => headers() : undefined,
      plugins: (batch ?? fetchImpl === undefined) ? [batchPlugin(base)] : [],
      url: `${base}/api`,
    })
  );
};

/** TanStack Query helpers: `api.conversations.list.queryOptions({ input })` and friends. */
export const createQueryUtils = (client: ApiClient) =>
  createTanstackQueryUtils(client);

export type QueryUtils = ReturnType<typeof createQueryUtils>;
