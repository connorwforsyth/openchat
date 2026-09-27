"use client";

import type { ApiClient } from "@workspace/client/api";
import {
  type LibraryClient,
  LibraryClientProvider,
} from "@workspace/library-ui/client";
import type { ReactNode } from "react";

import { useApi } from "@/app/(app)/_shared/api";

// The library screens over the app's API client and query cache (the
// frame's), so what they load is in the cache ⌘K reads and the one that's
// persisted (D28).

export function LibraryProviders({
  children,
}: {
  readonly children: ReactNode;
}) {
  const { client } = useApi();
  return (
    <LibraryClientProvider client={client as LibraryClient}>
      {children}
    </LibraryClientProvider>
  );
}

/** The raw API client, for what the library slice doesn't cover (runs). */
export const useApiClient = (): ApiClient => useApi().client;
