import { setupI18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type RenderResult, render } from "@testing-library/react";
import { createApiClient } from "@workspace/client/api";
import { ShortcutsProvider } from "@workspace/shortcuts/react/context";
import type { ReactNode } from "react";

import { ApiProvider } from "./api";

// Test-only: renders a page component against the real typed client over a
// fake `fetch`, so tests exercise the contract's routes and encodings (paths,
// query strings, 204s, typed errors) without a server. Routes are
// `"METHOD /path/:param"`, as in the contract.

export interface FakeRequest {
  readonly body: unknown;
  readonly params: Readonly<Record<string, string>>;
  readonly search: URLSearchParams;
}

export type FakeHandler = (request: FakeRequest) => unknown;

export interface FakeApi {
  /** Every call, in order, as `"METHOD /path"` with its parsed body. */
  readonly calls: { readonly body: unknown; readonly route: string }[];
  readonly fetch: typeof fetch;
}

/** A typed oRPC error response: `apiError("CONFLICT", 409, { reason })`. */
export const apiError = (code: string, status: number, data?: unknown) =>
  new Response(
    JSON.stringify({ code, data, defined: true, message: code, status }),
    { headers: { "content-type": "application/json" }, status }
  );

const API_PREFIX = /^\/api/;

const matchRoute = (
  pattern: string,
  method: string,
  path: string
): Record<string, string> | null => {
  const [wantMethod, wantPath = ""] = pattern.split(" ");
  if (wantMethod !== method) {
    return null;
  }
  const want = wantPath.split("/");
  const got = path.split("/");
  if (want.length !== got.length) {
    return null;
  }
  const params: Record<string, string> = {};
  for (const [index, segment] of want.entries()) {
    const actual = got[index] ?? "";
    if (segment.startsWith(":")) {
      params[segment.slice(1)] = decodeURIComponent(actual);
    } else if (segment !== actual) {
      return null;
    }
  }
  return params;
};

export const fakeApi = (routes: Record<string, FakeHandler>): FakeApi => {
  const calls: FakeApi["calls"] = [];
  const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const path = url.pathname.replace(API_PREFIX, "");
    const text = await request.text();
    const body: unknown = text ? JSON.parse(text) : undefined;
    calls.push({ body, route: `${request.method} ${path}` });
    const matched = Object.entries(routes)
      .map(([pattern, handler]) => ({
        handler,
        params: matchRoute(pattern, request.method, path),
      }))
      .find((each) => each.params !== null);
    if (!matched?.params) {
      return apiError("NOT_FOUND", 404);
    }
    const result = await matched.handler({
      body,
      params: matched.params,
      search: url.searchParams,
    });
    if (result instanceof Response) {
      return result;
    }
    return result === undefined
      ? new Response(null, { status: 204 })
      : Response.json(result);
  };
  return { calls, fetch: fakeFetch as typeof fetch };
};

const i18n = setupI18n({ locale: "en", messages: { en: {} } });

export const renderWithApi = (ui: ReactNode, api: FakeApi): RenderResult => {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  const client = createApiClient({
    baseUrl: "http://api.test",
    fetch: api.fetch,
  });
  return render(
    <I18nProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <ApiProvider client={client}>
          <ShortcutsProvider platform="mac">{ui}</ShortcutsProvider>
        </ApiProvider>
      </QueryClientProvider>
    </I18nProvider>
  );
};
