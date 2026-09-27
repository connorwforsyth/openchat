"use client";

import { useLingui } from "@lingui/react/macro";
import { useQueryClient } from "@tanstack/react-query";
import type {
  ConversationId,
  MessageId,
} from "@workspace/contract/schemas/common";
import { libraryKeys } from "@workspace/library-ui/cache";
import { CommandPalette } from "@workspace/palette/command-palette";
import {
  type PaletteAction,
  type PaletteLibraryItem,
  paletteAction,
} from "@workspace/palette/items";
import type { SearchChats } from "@workspace/palette/use-palette-search";
import { useShortcuts } from "@workspace/shortcuts/react/context";
import { ShortcutsHelpDialog } from "@workspace/shortcuts/react/help-dialog";
import { useShortcut } from "@workspace/shortcuts/react/use-shortcut";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useMemo } from "react";

import { routes } from "@/lib/routes";

import { useApi } from "./api";
import { useAppFrame } from "./app-frame";
import { chatsFromCache, libraryFromCache } from "./palette-cache";

// The global surfaces (D10, D14): the ⌘K palette and the `?` dialog, and the
// shortcuts that work on every page. Loaded after boot (see `AppFrame`); the
// chat screen binds its own view keys (J/K, [ ], S, A, ⌘B) while it's shown.

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

const isChatPath = (pathname: string): boolean =>
  pathname === routes.home || pathname.startsWith("/c/");

const useActions = (): readonly PaletteAction[] => {
  const { t } = useLingui();
  const router = useRouter();
  const pathname = usePathname();
  const { layout } = useAppFrame();
  const { setHelpOpen } = useShortcuts();
  const onChat = isChatPath(pathname);
  const { toggleSidebar, togglePanel } = layout;
  return useMemo(
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
          id: "action:toggle-sidebar",
          keywords: [t`chats`, t`hide`, t`show`],
          section: "actions",
          shortcutId: "sidebar.toggle",
          title: t`Toggle the sidebar`,
        },
        toggleSidebar
      ),
      ...(onChat
        ? [
            paletteAction(
              {
                id: "action:toggle-artifacts",
                keywords: [t`panel`],
                section: "actions",
                shortcutId: "panel.artifacts",
                title: t`Toggle the artifacts panel`,
              },
              () => togglePanel("artifacts")
            ),
          ]
        : []),
      paletteAction(
        {
          id: "action:library",
          keywords: [t`agents`, t`prompts`, t`skills`],
          section: "actions",
          title: t`Open the library`,
        },
        () => router.push(routes.library)
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
      paletteAction(
        {
          id: "action:shortcuts",
          keywords: [t`keyboard`, t`help`],
          section: "actions",
          shortcutId: "help",
          title: t`Show keyboard shortcuts`,
        },
        () => setHelpOpen(true)
      ),
    ],
    [onChat, router, setHelpOpen, t, toggleSidebar, togglePanel]
  );
};

export const GlobalSurfaces = () => {
  const { t } = useLingui();
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const { client, query } = useApi();
  const { chat, paletteOpen, setPaletteOpen } = useAppFrame();
  const settings = useSettingsEntries();
  const actions = useActions();
  const onChat = isChatPath(pathname);

  useShortcut("settings.open", () => router.push(routes.settings()));
  useShortcut("chat.new", () => router.push(routes.home));
  // Switching model is a palette job: it lists the models it can switch to.
  useShortcut("model.switch", () => setPaletteOpen(true), { enabled: onChat });

  const cachedChats = useCallback(
    () =>
      chatsFromCache(
        queryClient
          .getQueriesData({ queryKey: query.conversations.list.key() })
          .map(([, data]) => data)
      ),
    [query, queryClient]
  );

  // Both key styles: the library screens keep their own keys (017).
  const library = useMemo(
    () =>
      paletteOpen
        ? libraryFromCache(
            [
              ...queryClient.getQueriesData({ queryKey: libraryKeys.lists }),
              ...queryClient.getQueriesData({
                queryKey: query.library.list.key(),
              }),
            ].map(([, data]) => data)
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
    (item: PaletteLibraryItem) => router.push(routes.libraryItem(item.id)),
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
        context={onChat ? chat.paletteContext : undefined}
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
