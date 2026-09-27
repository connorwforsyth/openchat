"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import {
  Drawer,
  DrawerContent,
  DrawerTitle,
} from "@workspace/ui/components/drawer";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@workspace/ui/components/resizable";
import { createToastManager, Toaster } from "@workspace/ui/components/toast";
import { TooltipProvider } from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import {
  type ComponentProps,
  type ReactNode,
  useCallback,
  useRef,
  useState,
} from "react";

import { PANEL_MAX_WIDTH, PANEL_MIN_WIDTH } from "../model/layout";
import { type Platform, PlatformProvider } from "./platform";
import { useNarrowScreen } from "./use-narrow-screen";

// The chosen app shell (ticket 009: Classic sidebar + Workspace panels): a
// collapsible sidebar, then the conversation column (header on top, content,
// composer docked at the bottom), then an optional resizable right panel.
// Below `md` the sidebar is a sheet from the start edge and the right panel a
// bottom sheet (both modal: focus stays inside, Esc or a swipe closes them).
// Layout only; what goes in each slot comes from the caller.

type PanelSize = Parameters<
  NonNullable<ComponentProps<typeof ResizablePanel>["onResize"]>
>[0];
type LayoutChangedMeta = Parameters<
  NonNullable<ComponentProps<typeof ResizablePanelGroup>["onLayoutChanged"]>
>[1];

export interface AppShellProps {
  /** The conversation column under the header: messages and composer. */
  readonly children: ReactNode;
  readonly className?: string;
  readonly header: ReactNode;
  /** A narrow screen's panel sheet was dismissed (Esc, swipe, backdrop). */
  readonly onPanelClose: () => void;
  readonly onPanelWidthChange?: (width: number) => void;
  readonly onSidebarSheetOpenChange: (open: boolean) => void;
  /**
   * The right panel's content. Kept while it closes, so a sheet fades out
   * with its content rather than empty.
   */
  readonly panel: ReactNode;
  readonly panelOpen: boolean;
  readonly panelWidth: number;
  readonly platform?: Platform;
  readonly sidebar: ReactNode;
  /** The sidebar beside the conversation (wide screens). */
  readonly sidebarOpen: boolean;
  /** The sidebar as a sheet (narrow screens). */
  readonly sidebarSheetOpen: boolean;
}

export function AppShell({
  children,
  className,
  header,
  onPanelClose,
  onPanelWidthChange,
  onSidebarSheetOpenChange,
  panel,
  panelOpen,
  panelWidth,
  platform = "web",
  sidebar,
  sidebarOpen,
  sidebarSheetOpen,
}: AppShellProps) {
  const { t } = useLingui();
  const narrow = useNarrowScreen();
  // One toast queue per shell (undo toasts), not a module-level singleton.
  const [toastManager] = useState(createToastManager);
  // Dragging reports every frame; only a finished, user-made resize is kept.
  const dragged = useRef<number | null>(null);
  const onPanelResize = useCallback((size: PanelSize) => {
    dragged.current = size.inPixels;
  }, []);
  const onLayoutChanged = useCallback(
    (_layout: unknown, meta: LayoutChangedMeta) => {
      if (meta.isUserInteraction && dragged.current !== null) {
        onPanelWidthChange?.(dragged.current);
      }
    },
    [onPanelWidthChange]
  );
  const onPanelSheetOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        onPanelClose();
      }
    },
    [onPanelClose]
  );

  return (
    <PlatformProvider platform={platform}>
      <TooltipProvider>
        <Toaster toastManager={toastManager}>
          <div
            className={cn(
              // dvh follows the browser's collapsing toolbars, so the
              // composer stays docked at the bottom of what's visible.
              "flex h-dvh min-h-0 w-full overflow-hidden bg-background text-foreground",
              className
            )}
            data-slot="app-shell"
          >
            {sidebarOpen && !narrow ? (
              <aside
                aria-label={t`Chats`}
                className="flex w-64 shrink-0 flex-col border-sidebar-border border-e bg-sidebar text-sidebar-foreground max-md:hidden"
                data-slot="app-shell-sidebar"
              >
                {sidebar}
              </aside>
            ) : null}
            <ResizablePanelGroup
              className="min-w-0 flex-1"
              onLayoutChanged={onLayoutChanged}
              orientation="horizontal"
            >
              <ResizablePanel id="conversation" minSize="360px">
                <div className="flex h-full min-h-0 min-w-0 flex-col">
                  {header}
                  <main className="flex min-h-0 flex-1 flex-col">
                    {children}
                  </main>
                </div>
              </ResizablePanel>
              {panelOpen && !narrow ? (
                <>
                  <ResizableHandle />
                  <ResizablePanel
                    defaultSize={`${panelWidth}px`}
                    groupResizeBehavior="preserve-pixel-size"
                    id="side-panel"
                    maxSize={`${PANEL_MAX_WIDTH}px`}
                    minSize={`${PANEL_MIN_WIDTH}px`}
                    onResize={onPanelResize}
                  >
                    <aside
                      aria-label={t`Side panel`}
                      className="flex h-full min-h-0 flex-col bg-background"
                    >
                      {panel}
                    </aside>
                  </ResizablePanel>
                </>
              ) : null}
            </ResizablePanelGroup>
          </div>
          {narrow ? (
            <>
              <Drawer
                onOpenChange={onSidebarSheetOpenChange}
                open={sidebarSheetOpen}
                swipeDirection="left"
              >
                <DrawerContent
                  className="w-[min(18rem,85vw)] bg-sidebar text-sidebar-foreground"
                  data-slot="app-shell-sidebar-sheet"
                >
                  <DrawerTitle className="sr-only">
                    <Trans>Chats</Trans>
                  </DrawerTitle>
                  <div className="flex min-h-0 flex-1 flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
                    {sidebar}
                  </div>
                </DrawerContent>
              </Drawer>
              <Drawer
                onOpenChange={onPanelSheetOpenChange}
                open={panelOpen}
                showSwipeHandle
              >
                <DrawerContent
                  className="h-[85dvh] bg-background"
                  data-slot="app-shell-panel-sheet"
                >
                  <DrawerTitle className="sr-only">
                    <Trans>Side panel</Trans>
                  </DrawerTitle>
                  <div className="flex min-h-0 flex-1 flex-col pb-[env(safe-area-inset-bottom)]">
                    {panel}
                  </div>
                </DrawerContent>
              </Drawer>
            </>
          ) : null}
        </Toaster>
      </TooltipProvider>
    </PlatformProvider>
  );
}
