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
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useMemo } from "react";

import { routes } from "@/lib/routes";

import { useApi } from "./api";
import { canAdmin, useAppFrame } from "./app-frame";
import { chatsFromCache, libraryFromCache } from "./palette-cache";
import {
  closeSettings,
  type SettingsSection,
  selectSettingsSection,
  settingsRouteFromPath,
} from "./settings/settings-route";
import { SettingsView } from "./settings/settings-view";
import { useTerms } from "./terms";

// The global surfaces (D10, D14): the ⌘K palette and the `?` dialog, and the
// shortcuts that work on every page. Loaded after boot (see `AppFrame`); the
// chat screen binds its own view keys (J/K, [ ], S, A, ⌘B) while it's shown.

const useSettingsEntries = (): readonly PaletteAction[] => {
  const { t } = useLingui();
  const router = useRouter();
  const { openSettings } = useAppFrame();
  const { label } = useTerms().mcp;
  return useMemo(() => {
    const go = (section: SettingsSection) => () => openSettings(section);
    return [
      paletteAction(
        {
          id: "settings:profile",
          keywords: [t`language`, t`locale`, t`name`],
          section: "settings",
          title: t`Profile and language`,
        },
        go("profile")
      ),
      paletteAction(
        {
          id: "settings:keys",
          keywords: [t`API keys`, t`providers`],
          section: "settings",
          title: t`Provider keys`,
        },
        go("keys")
      ),
      paletteAction(
        {
          id: "settings:mcp",
          keywords: [t`MCP`, t`servers`, t`tools`, t`connectors`],
          section: "settings",
          title: label,
        },
        go("mcp")
      ),
      paletteAction(
        { id: "settings:memory", section: "settings", title: t`Memory` },
        go("memory")
      ),
      paletteAction(
        {
          id: "settings:shortcuts",
          keywords: [t`keyboard`, t`hotkeys`],
          section: "settings",
          title: t`Keyboard shortcuts`,
        },
        go("shortcuts")
      ),
      paletteAction(
        {
          id: "settings:appearance",
          keywords: [t`theme`, t`dark`, t`light`],
          section: "settings",
          title: t`Appearance`,
        },
        go("appearance")
      ),
      paletteAction(
        {
          id: "settings:admin",
          keywords: [t`org`, t`members`, t`policies`, t`budgets`],
          section: "settings",
          title: t`Admin`,
        },
        () => router.push(routes.admin)
      ),
    ];
  }, [label, openSettings, router, t]);
};

const isChatPath = (pathname: string): boolean =>
  pathname === routes.home || pathname.startsWith("/c/");

const useActions = (): readonly PaletteAction[] => {
  const { t } = useLingui();
  const router = useRouter();
  const pathname = usePathname();
  const { layout, openSettings } = useAppFrame();
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
        () => openSettings()
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
    [onChat, openSettings, router, setHelpOpen, t, toggleSidebar, togglePanel]
  );
};

export const GlobalSurfaces = () => {
  const { t } = useLingui();
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const { client, query } = useApi();
  const { chat, me, openSettings, paletteOpen, setPaletteOpen } = useAppFrame();
  const { setHelpOpen } = useShortcuts();
  const terms = useTerms();
  const settingsRoute = settingsRouteFromPath(pathname, terms);
  const settings = useSettingsEntries();
  const actions = useActions();
  const onChat = isChatPath(pathname);

  useShortcut("settings.open", () => openSettings());
  const closeSettingsView = useCallback(
    () => closeSettings(window.history, routes.home),
    []
  );
  useShortcut("chat.new", () => router.push(routes.home));
  // Switching model is a palette job: it lists the models it can switch to.
  useShortcut("model.switch", () => setPaletteOpen(true), { enabled: onChat });

  const changeShortcuts = useCallback(() => {
    setHelpOpen(false);
    openSettings("shortcuts");
  }, [openSettings, setHelpOpen]);
  const openAdmin = useCallback(() => router.push(routes.admin), [router]);
  const selectSection = useCallback(
    (section: SettingsSection | undefined) =>
      selectSettingsSection(window.history, terms, section),
    [terms]
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
          <button
            className="text-muted-foreground text-sm underline-offset-4 hover:underline"
            onClick={changeShortcuts}
            type="button"
          >
            {t`Change shortcuts`}
          </button>
        }
      />
      <SettingsView
        onClose={closeSettingsView}
        onOpenAdmin={canAdmin(me) ? openAdmin : undefined}
        onSelect={selectSection}
        route={settingsRoute}
      />
    </>
  );
};
