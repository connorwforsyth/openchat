import { createORPCClient } from "@orpc/client";
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
  /** For tests and non-browser runtimes. */
  readonly fetch?: typeof fetch;
  /** Extra headers per request (a bearer token on desktop). */
  readonly headers?: () =>
    | Record<string, string>
    | Promise<Record<string, string>>;
}

const TRAILING_SLASH = /\/$/;

const origin = (baseUrl: string): string => {
  if (baseUrl) {
    return baseUrl.replace(TRAILING_SLASH, "");
  }
  return typeof window === "undefined"
    ? "http://localhost"
    : window.location.origin;
};

export const createApiClient = ({
  baseUrl = "",
  fetch: fetchImpl,
  headers,
}: ApiClientOptions = {}): ApiClient =>
  createORPCClient(
    new OpenAPILink(contract, {
      // Same-origin requests carry the session cookie.
      fetch: (request, init) =>
        (fetchImpl ?? globalThis.fetch)(request, {
          ...init,
          credentials: "include",
        }),
      headers: headers ? () => headers() : undefined,
      url: `${origin(baseUrl)}/api`,
    })
  );

/** TanStack Query helpers: `api.conversations.list.queryOptions({ input })` and friends. */
export const createQueryUtils = (client: ApiClient) =>
  createTanstackQueryUtils(client);

export type QueryUtils = ReturnType<typeof createQueryUtils>;
