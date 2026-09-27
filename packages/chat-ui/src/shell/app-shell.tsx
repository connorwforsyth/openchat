"use client";

import { useLingui } from "@lingui/react/macro";
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

// The chosen app shell (ticket 009: Classic sidebar + Workspace panels): a
// collapsible sidebar, then the conversation column (header on top, content,
// composer docked at the bottom), then an optional resizable right panel.
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
  readonly onPanelWidthChange?: (width: number) => void;
  /** The right panel's content, or `null` when it's closed. */
  readonly panel: ReactNode | null;
  readonly panelWidth: number;
  readonly platform?: Platform;
  readonly sidebar: ReactNode;
  readonly sidebarOpen: boolean;
}

export function AppShell({
  children,
  className,
  header,
  onPanelWidthChange,
  panel,
  panelWidth,
  platform = "web",
  sidebar,
  sidebarOpen,
}: AppShellProps) {
  const { t } = useLingui();
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

  return (
    <PlatformProvider platform={platform}>
      <TooltipProvider>
        <Toaster toastManager={toastManager}>
          <div
            className={cn(
              "flex h-svh min-h-0 w-full overflow-hidden bg-background text-foreground",
              className
            )}
            data-slot="app-shell"
          >
            {sidebarOpen ? (
              <aside
                aria-label={t`Chats`}
                className="flex w-64 shrink-0 flex-col border-sidebar-border border-e bg-sidebar text-sidebar-foreground"
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
              {panel === null ? null : (
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
              )}
            </ResizablePanelGroup>
          </div>
        </Toaster>
      </TooltipProvider>
    </PlatformProvider>
  );
}
