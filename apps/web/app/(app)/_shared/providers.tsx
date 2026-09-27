"use client";

import { useLingui } from "@lingui/react/macro";
import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  ConversationId,
  MessageId,
  UserId,
} from "@workspace/contract/schemas/common";
import { CommandPalette } from "@workspace/palette/command-palette";
import {
  type PaletteAction,
  type PaletteLibraryItem,
  paletteAction,
} from "@workspace/palette/items";
import type { SearchChats } from "@workspace/palette/use-palette-search";
import { createStorageOverridesStore } from "@workspace/shortcuts/ports/overrides-store.storage";
import { ShortcutsProvider } from "@workspace/shortcuts/react/context";
import { ShortcutsHelpDialog } from "@workspace/shortcuts/react/help-dialog";
import { useShortcut } from "@workspace/shortcuts/react/use-shortcut";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useCallback, useMemo, useState } from "react";

import { ApiProvider, useApi } from "./api";
import { chatsFromCache, libraryFromCache } from "./palette-cache";
import { routes } from "./routes";

// Client providers for the signed-in pages: the query cache, the API client,
// shortcuts (with the user's recorded overrides) and the global surfaces
// they drive, the ⌘K palette and the `?` dialog. 025 moves these into 015's
// AppShell; until then settings and admin mount them.

const browserStorage = () => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    // Storage blocked (privacy settings): shortcuts fall back to defaults.
    return null;
  }
};

const useSettingsEntries = (): readonly PaletteAction[] => {
  const { t } = useLingui();
  const router = useRouter();
  return useMemo(() => {
    const go = (href: string) => () => router.push(href);
    return [
      paletteAction(
        {
          id: "settings:profile",
          keywords: [t`language`, t`locale`, t`name`],
          section: "settings",
          title: t`Profile and language`,
        },
        go(routes.settings("profile"))
      ),
      paletteAction(
        {
          id: "settings:keys",
          keywords: [t`API keys`, t`providers`],
          section: "settings",
          title: t`Provider keys`,
        },
        go(routes.settings("keys"))
      ),
      paletteAction(
        { id: "settings:memory", section: "settings", title: t`Memory` },
        go(routes.settings("memory"))
      ),
      paletteAction(
        {
          id: "settings:shortcuts",
          keywords: [t`keyboard`, t`hotkeys`],
          section: "settings",
          title: t`Keyboard shortcuts`,
        },
        go(routes.settings("shortcuts"))
      ),
      paletteAction(
        {
          id: "settings:appearance",
          keywords: [t`theme`, t`dark`, t`light`],
          section: "settings",
          title: t`Appearance`,
        },
        go(routes.settings("appearance"))
      ),
      paletteAction(
        {
          id: "settings:admin",
          keywords: [t`org`, t`members`, t`policies`, t`budgets`],
          section: "settings",
          title: t`Admin`,
        },
        go(routes.admin)
      ),
    ];
  }, [router, t]);
};

const GlobalSurfaces = () => {
  const { t } = useLingui();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { client, query } = useApi();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const settings = useSettingsEntries();

  useShortcut("settings.open", () => router.push(routes.settings()));
  useShortcut("chat.new", () => router.push(routes.home));

  const actions = useMemo(
    () => [
      paletteAction(
        {
          id: "action:new-chat",
          section: "actions",
          shortcutId: "chat.new",
          title: t`New chat`,
        },
        () => router.push(routes.home)
      ),
      paletteAction(
        {
          id: "action:settings",
          section: "actions",
          shortcutId: "settings.open",
          title: t`Open settings`,
        },
        () => router.push(routes.settings())
      ),
    ],
    [router, t]
  );

  const cachedChats = useCallback(
    () =>
      chatsFromCache(
        queryClient
          .getQueriesData({ queryKey: query.conversations.list.key() })
          .map(([, data]) => data)
      ),
    [query, queryClient]
  );

  const library = useMemo(
    () =>
      paletteOpen
        ? libraryFromCache(
            queryClient
              .getQueriesData({ queryKey: query.library.list.key() })
              .map(([, data]) => data)
          )
        : [],
    [paletteOpen, query, queryClient]
  );

  const searchChats = useCallback<SearchChats>(
    async (text, signal) =>
      (
        await client.search.conversations(
          { limit: 10, query: text },
          { signal }
        )
      ).items,
    [client]
  );

  const askAi = useCallback(
    (prompt: string) => router.push(routes.askAi(prompt)),
    [router]
  );
  const openLibraryItem = useCallback(
    (item: PaletteLibraryItem) => router.push(routes.library(item.id)),
    [router]
  );
  const selectChat = useCallback(
    (id: ConversationId, messageId: MessageId | null) =>
      router.push(routes.chat(id, messageId)),
    [router]
  );

  return (
    <>
      <CommandPalette
        actions={actions}
        cachedChats={cachedChats}
        library={library}
        onAskAi={askAi}
        onOpenChange={setPaletteOpen}
        onOpenLibraryItem={openLibraryItem}
        onSelectChat={selectChat}
        open={paletteOpen}
        searchChats={searchChats}
        settings={settings}
      />
      <ShortcutsHelpDialog
        footer={
          <Link
            className="text-muted-foreground text-sm underline-offset-4 hover:underline"
            href={routes.settings("shortcuts")}
          >
            {t`Change shortcuts`}
          </Link>
        }
      />
    </>
  );
};

export const AppProviders = ({
  children,
  userId,
}: {
  readonly children: ReactNode;
  readonly userId: UserId;
}) => {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          // Settings data changes rarely and every mutation invalidates what
          // it touched, so don't refetch on every focus.
          queries: { refetchOnWindowFocus: false, retry: 1, staleTime: 30_000 },
        },
      })
  );
  const [store] = useState(() =>
    createStorageOverridesStore(browserStorage(), `shortcuts:${userId}`)
  );
  return (
    <QueryClientProvider client={queryClient}>
      <ApiProvider>
        <ShortcutsProvider store={store}>
          {children}
          <GlobalSurfaces />
        </ShortcutsProvider>
      </ApiProvider>
    </QueryClientProvider>
  );
};
