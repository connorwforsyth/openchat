"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ApiClient, createApiClient } from "@workspace/client/api";
import {
  type LibraryClient,
  LibraryClientProvider,
} from "@workspace/library-ui/client";
import { createContext, type ReactNode, useContext, useState } from "react";

// The library's data layer until the app shell (025) provides one for the
// whole app: a query client and the typed API client, same origin. Without
// a server behind `/api` the screens show their error states; nothing
// crashes.

const ApiContext = createContext<ApiClient | null>(null);

export function LibraryProviders({
  children,
}: {
  readonly children: ReactNode;
}) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
      })
  );
  const [api] = useState(() => createApiClient());
  return (
    <QueryClientProvider client={queryClient}>
      <ApiContext.Provider value={api}>
        <LibraryClientProvider client={api as LibraryClient}>
          {children}
        </LibraryClientProvider>
      </ApiContext.Provider>
    </QueryClientProvider>
  );
}

/** The raw API client, for what the library slice doesn't cover (runs). */
export const useApiClient = (): ApiClient => {
  const api = useContext(ApiContext);
  if (!api) {
    throw new Error("useApiClient needs <LibraryProviders>");
  }
  return api;
};
