"use client";

import { Trans } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import {
  SIDEBAR_LIST_INPUT,
  useConversationUpdate,
} from "@workspace/chat-ui/chat/use-chat-data";
import { AppHeader } from "@workspace/chat-ui/header/app-header";
import { AppShell } from "@workspace/chat-ui/shell/app-shell";
import { useSidebarLayout } from "@workspace/chat-ui/shell/sidebar-layout";
import { SidebarToggle } from "@workspace/chat-ui/shell/sidebar-toggle";
import { useNarrowScreen } from "@workspace/chat-ui/shell/use-narrow-screen";
import { ChatSidebar } from "@workspace/chat-ui/sidebar/chat-sidebar";
import {
  type RailDestination,
  SidebarRail,
} from "@workspace/chat-ui/sidebar/sidebar-rail";
import { useSidebarData } from "@workspace/chat-ui/sidebar/use-sidebar-data";
import type { ConversationId } from "@workspace/contract/schemas/common";
import { useShortcut } from "@workspace/shortcuts/react/use-shortcut";
import { usePathname, useRouter } from "next/navigation";
import {
  type ReactNode,
  Suspense,
  useCallback,
  useMemo,
  useState,
} from "react";

import { useApi } from "@/app/(app)/_shared/api";
import { canAdmin, useAppFrame } from "@/app/(app)/_shared/app-frame";
import { Brand } from "@/app/(app)/_shared/brand";
import { useShellPlatform } from "@/app/(app)/_shared/desktop";
import { useSidebarDots } from "@/app/(app)/(pages)/dots/sidebar-dots";
import { RailPanelFor } from "@/app/(app)/(pages)/rail-panels";
import { routes } from "@/lib/routes";

// Library, settings and admin inside the app shell (009): the same sidebar
// and layout as the chat, a plain header, and the page in the main column.
// The chat screen builds its own shell (it owns the header and the panel);
// both read the frame's layout, so the sidebar stays as it was left.

const noPanel = () => undefined;

// Library, Artifacts and Scheduled have a large heading of their own, so
// the header names only the pages that don't, as the chat header names only
// its chat (181): a title shows once.
const SectionTitle = ({ pathname }: { readonly pathname: string }) => {
  if (
    pathname.startsWith(routes.library) ||
    pathname.startsWith(routes.artifacts) ||
    pathname.startsWith(routes.dots)
  ) {
    return null;
  }
  if (pathname.startsWith(routes.admin)) {
    return <Trans>Admin</Trans>;
  }
  return <Trans>Settings</Trans>;
};

/** Which rail button is current on a page. */
const railDestination = (pathname: string): RailDestination => {
  if (pathname.startsWith(routes.library)) {
    return "library";
  }
  if (pathname.startsWith(routes.artifacts)) {
    return "artifacts";
  }
  if (pathname.startsWith(routes.dots)) {
    return "scheduled";
  }
  return "chats";
};

/** Destinations whose panel isn't the chat list (181). */
const ownPanel = (destination: RailDestination): boolean =>
  destination === "artifacts" ||
  destination === "library" ||
  destination === "scheduled";

export function PageShell({ children }: { readonly children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const narrow = useNarrowScreen();
  const railed = useSidebarLayout() === "rail";
  const { query } = useApi();
  const frame = useAppFrame();
  const { layout, me } = frame;
  const platform = useShellPlatform();
  const [sheetOpen, setSheetOpen] = useState(false);
  const chats = useQuery(
    query.conversations.list.queryOptions({ input: SIDEBAR_LIST_INPUT })
  );
  const update = useConversationUpdate(query);
  const sidebarDots = useSidebarDots(null);
  const destination = railDestination(pathname);
  // With the rail on a wide screen, the panel follows it; classic, and the
  // phone's sheet, keep the chat list everywhere.
  const panel =
    railed && !narrow && ownPanel(destination) ? (
      <Suspense>
        <RailPanelFor destination={destination} />
      </Suspense>
    ) : undefined;
  const sidebarData = useSidebarData(query);

  const { toggleSidebar } = layout;
  const toggleChats = useCallback(() => {
    if (narrow) {
      setSheetOpen((open) => !open);
    } else {
      toggleSidebar();
    }
  }, [narrow, toggleSidebar]);
  useShortcut("sidebar.toggle", toggleChats);

  // The rail's Chats button: back to chatting, with the chat panel open.
  const showChats = useCallback(() => {
    if (!layout.layout.sidebarOpen) {
      toggleSidebar();
    }
    router.push(routes.home);
  }, [layout.layout.sidebarOpen, router, toggleSidebar]);

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

  const sidebarToggle = (where: "header" | "rail" | "sidebar") => (
    <SidebarToggle
      expanded={narrow ? sheetOpen : layout.layout.sidebarOpen}
      onToggle={toggleChats}
      placement={where}
    />
  );
  const header = (
    <AppHeader
      center={
        <span className="truncate font-medium text-sm">
          <SectionTitle pathname={pathname} />
        </span>
      }
      // With the rail (181) the sidebar toggle is here only on a narrow
      // screen; classic puts it here whenever the sidebar is collapsed.
      start={sidebarToggle("header")}
    />
  );

  const sidebarProps = {
    ...sidebarActions,
    ...sidebarDots,
    ...sidebarData,
    account: {
      onNewOrg: frame.openNewOrg,
      // Org owners and admins reach admin too, not only the instance admin.
      onOpenAdmin: canAdmin(me) ? () => router.push(routes.admin) : undefined,
      onOpenSettings: () => router.push(routes.settings()),
      onSignOut: frame.signOut,
      onThemeChange: frame.setTheme,
      theme: frame.theme,
      user: me.user,
    },
    activeId: null,
    artifactsHref: routes.artifacts,
    chats: chats.data?.items ?? [],
    dotsHref: routes.dots,
    libraryHref: routes.library,
    onSelect: selectChat,
    // Schedules live on the Dot's page for now.
    scheduledHref: routes.dots,
  };

  return (
    <AppShell
      header={header}
      onPanelClose={noPanel}
      onSidebarSheetOpenChange={setSheetOpen}
      panel={null}
      panelOpen={false}
      panelWidth={layout.layout.panelWidth}
      platform={platform}
      rail={
        railed ? (
          <SidebarRail
            {...sidebarProps}
            current={destination}
            onShowChats={showChats}
            toggle={sidebarToggle("rail")}
          />
        ) : undefined
      }
      sidebar={
        <ChatSidebar
          {...sidebarProps}
          brand={<Brand config={frame.config} />}
          onNewChat={newChat}
          onOpenPalette={openPalette}
          panel={panel}
          railed={railed}
          toggle={sidebarToggle("sidebar")}
        />
      }
      sidebarOpen={layout.layout.sidebarOpen}
      sidebarSheetOpen={sheetOpen}
    >
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </AppShell>
  );
}
