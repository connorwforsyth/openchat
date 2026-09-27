"use client";

import {
  type ApiClient,
  createApiClient,
  createQueryUtils,
  type QueryUtils,
} from "@workspace/client/api";
import { createContext, type ReactNode, useContext, useState } from "react";

// The typed API client and its TanStack Query helpers (D11), from context so
// tests hand in a client over a fake `fetch` and pages never build their own.

interface Api {
  readonly client: ApiClient;
  readonly query: QueryUtils;
}

const ApiContext = createContext<Api | null>(null);

export const ApiProvider = ({
  children,
  client,
}: {
  readonly children: ReactNode;
  /** Defaults to the same-origin client. */
  readonly client?: ApiClient;
}) => {
  const [api] = useState<Api>(() => {
    const resolved = client ?? createApiClient();
    return { client: resolved, query: createQueryUtils(resolved) };
  });
  return <ApiContext.Provider value={api}>{children}</ApiContext.Provider>;
};

export const useApi = (): Api => {
  const api = useContext(ApiContext);
  if (!api) {
    // Every settings and admin page renders under the (app) layout.
    throw new Error("useApi needs an ApiProvider");
  }
  return api;
};
