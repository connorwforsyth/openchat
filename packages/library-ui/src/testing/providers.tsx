import { setupI18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { LibraryClientProvider } from "../client";
import { createFakeLibraryClient, type FakeLibraryClient } from "./fake-client";

// Everything a library screen needs around it in a test or the demo: an
// English Lingui instance, a query client that doesn't retry (a refusal
// should show at once) and the fake API.

const i18n = setupI18n({ locale: "en", messages: { en: {} } });

export interface TestProviders {
  readonly client: FakeLibraryClient;
  readonly queryClient: QueryClient;
  readonly wrap: (children: ReactNode) => ReactNode;
}

export const createTestProviders = (
  client: FakeLibraryClient = createFakeLibraryClient()
): TestProviders => {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
    },
  });
  return {
    client,
    queryClient,
    wrap: (children) => (
      <I18nProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>
          <LibraryClientProvider client={client}>
            {children}
          </LibraryClientProvider>
        </QueryClientProvider>
      </I18nProvider>
    ),
  };
};
