"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import {
  SIDEBAR_LIST_INPUT,
  useConversationUpdate,
} from "@workspace/chat-ui/chat/use-chat-data";
import { AppHeader } from "@workspace/chat-ui/header/app-header";
import { AppShell } from "@workspace/chat-ui/shell/app-shell";
import { useNarrowScreen } from "@workspace/chat-ui/shell/use-narrow-screen";
import { ChatSidebar } from "@workspace/chat-ui/sidebar/chat-sidebar";
import type { ConversationId } from "@workspace/contract/schemas/common";
import { NewChatIcon, PanelLeftIcon } from "@workspace/icons";
import { useShortcut } from "@workspace/shortcuts/react/use-shortcut";
import { Button } from "@workspace/ui/components/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useCallback, useMemo, useState } from "react";

import { useApi } from "@/app/(app)/_shared/api";
import { canAdmin, useAppFrame } from "@/app/(app)/_shared/app-frame";
import { Brand } from "@/app/(app)/_shared/brand";
import { routes } from "@/lib/routes";

// Library, settings and admin inside the app shell (009): the same sidebar
// and layout as the chat, a plain header, and the page in the main column.
// The chat screen builds its own shell (it owns the header and the panel);
// both read the frame's layout, so the sidebar stays as it was left.

const noPanel = () => undefined;

const SectionTitle = ({ pathname }: { readonly pathname: string }) => {
  if (pathname.startsWith(routes.library)) {
    return <Trans>Library</Trans>;
  }
  if (pathname.startsWith(routes.admin)) {
    return <Trans>Admin</Trans>;
  }
  return <Trans>Settings</Trans>;
};

export function PageShell({ children }: { readonly children: ReactNode }) {
  const { t } = useLingui();
  const router = useRouter();
  const pathname = usePathname();
  const narrow = useNarrowScreen();
  const { query } = useApi();
  const frame = useAppFrame();
  const { layout, me } = frame;
  const [sheetOpen, setSheetOpen] = useState(false);
  const chats = useQuery(
    query.conversations.list.queryOptions({ input: SIDEBAR_LIST_INPUT })
  );
  const update = useConversationUpdate(query);

  const { toggleSidebar } = layout;
  const toggleChats = useCallback(() => {
    if (narrow) {
      setSheetOpen((open) => !open);
    } else {
      toggleSidebar();
    }
  }, [narrow, toggleSidebar]);
  useShortcut("sidebar.toggle", toggleChats);

  const newChat = useCallback(() => {
    setSheetOpen(false);
    router.push(routes.home);
  }, [router]);
  const openPalette = useCallback(() => {
    setSheetOpen(false);
    frame.openPalette();
  }, [frame]);
  // The chat screen binds ⌘K itself; these pages have to as well (040's e2e).
  useShortcut("palette.open", openPalette);
  const selectChat = useCallback(
    (id: ConversationId) => {
      setSheetOpen(false);
      router.push(routes.chat(id));
    },
    [router]
  );
  const sidebarActions = useMemo(
    () => ({
      onArchive: (id: ConversationId) => update({ archived: true, id }),
      onRename: (id: ConversationId, title: string) => update({ id, title }),
      onRestore: (id: ConversationId) => update({ archived: false, id }),
      onTogglePin: (id: ConversationId, pinned: boolean) =>
        update({ id, pinned }),
    }),
    [update]
  );

  const header = (
    <AppHeader
      center={
        <span className="truncate font-medium text-sm">
          <SectionTitle pathname={pathname} />
        </span>
      }
      start={
        <>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  aria-expanded={narrow ? sheetOpen : layout.layout.sidebarOpen}
                  aria-label={t`Toggle sidebar`}
                  onClick={toggleChats}
                  size="icon-sm"
                  variant="ghost"
                />
              }
            >
              <PanelLeftIcon aria-hidden />
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <Trans>Toggle sidebar</Trans>
            </TooltipContent>
          </Tooltip>
          {layout.layout.sidebarOpen && !narrow ? null : (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    aria-label={t`New chat`}
                    onClick={newChat}
                    size="icon-sm"
                    variant="ghost"
                  />
                }
              >
                <NewChatIcon aria-hidden />
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <Trans>New chat</Trans>
              </TooltipContent>
            </Tooltip>
          )}
        </>
      }
      underWindowControls={!layout.layout.sidebarOpen}
    />
  );

  return (
    <AppShell
      header={header}
      onPanelClose={noPanel}
      onSidebarSheetOpenChange={setSheetOpen}
      panel={null}
      panelOpen={false}
      panelWidth={layout.layout.panelWidth}
      sidebar={
        <ChatSidebar
          {...sidebarActions}
          account={{
            onNewOrg: frame.openNewOrg,
            // Org owners and admins reach admin too, not only the instance admin.
            onOpenAdmin: canAdmin(me)
              ? () => router.push(routes.admin)
              : undefined,
            onOpenSettings: () => router.push(routes.settings()),
            onSignOut: frame.signOut,
            onThemeChange: frame.setTheme,
            theme: frame.theme,
            user: me.user,
          }}
          activeId={null}
          brand={<Brand config={frame.config} />}
          chats={chats.data?.items ?? []}
          libraryHref={routes.library}
          onNewChat={newChat}
          onOpenPalette={openPalette}
          onSelect={selectChat}
        />
      }
      sidebarOpen={layout.layout.sidebarOpen}
      sidebarSheetOpen={sheetOpen}
    >
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </AppShell>
  );
}
