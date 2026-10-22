"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import {
  Drawer,
  DrawerContent,
  DrawerTitle,
} from "@workspace/ui/components/drawer";
import { ResizeHandle } from "@workspace/ui/components/resizable";
import { createToastManager, Toaster } from "@workspace/ui/components/toast";
import { TooltipProvider } from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import {
  fitShellColumns,
  PANEL_DEFAULT_WIDTH,
  PANEL_MIN_WIDTH,
  RESIZE_KEY_STEP,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MIN_WIDTH,
} from "../model/layout";
import { type Platform, PlatformProvider } from "./platform";
import {
  SidebarDockedProvider,
  SidebarRailedProvider,
  SidebarShownProvider,
} from "./sidebar-toggle";
import { useNarrowScreen } from "./use-narrow-screen";
import { useSidebarWidth } from "./use-shell-layout";

// The chosen app shell (ticket 009: Classic sidebar + Workspace panels): a
// collapsible sidebar, then the conversation column (header on top, content,
// composer docked at the bottom), then an optional right panel. Both sides
// resize from a handle on their edge (071), and the conversation keeps at
// least `CENTRE_MIN_WIDTH`: the sidebar yields first, then the panel. When
// there's no room to dock the sidebar, the toggle shows it over the page
// instead. Below `md` the sidebar is a sheet from the start edge and the
// right panel a bottom sheet (both modal: focus stays inside, Esc or a swipe
// closes them). Layout only; what goes in each slot comes from the caller.

// The saved width is on `<html>` before React runs (the app's pre-paint
// script), and a shell mounted later inherits the latest; 260px otherwise.
const SIDEBAR_WIDTH_CLASS = "w-[var(--app-sidebar-width,260px)]";

const subscribeToResize = (onChange: () => void) => {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
};
const viewportWidth = () => document.documentElement.clientWidth;
const noViewport = () => null;

/** The window's width, following resizes; `null` on the server. */
const useViewportWidth = (): number | null =>
  useSyncExternalStore(subscribeToResize, viewportWidth, noViewport);

export interface AppShellProps {
  /** The conversation column under the header: messages and composer. */
  readonly children: ReactNode;
  /**
   * The layout's `claimSidebarToggle`: while the sidebar has no room to
   * dock, the shell takes the toggle to show it over the page.
   */
  readonly claimSidebarToggle: (toggle: (() => void) | null) => void;
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
  /**
   * The permanent icon rail on a wide screen (181), at the window's start
   * edge whether the sidebar is open or not. With it, the sidebar and the
   * conversation sit in an inset card on the window background.
   */
  readonly rail?: ReactNode;
  readonly sidebar: ReactNode;
  /** The sidebar beside the conversation (wide screens). */
  readonly sidebarOpen: boolean;
  /**
   * The sidebar over the page: a narrow screen's sheet, or the overlay a wide
   * one shows when there's no room to dock it.
   */
  readonly sidebarSheetOpen: boolean;
}

/** The icon rail (181); no transition, as its toggle is a key (D28). */
function RailSlot({ rail }: { readonly rail: ReactNode }) {
  return rail ? (
    <div className="flex shrink-0 max-md:hidden" data-slot="app-shell-rail">
      {rail}
    </div>
  ) : null;
}

/**
 * The rail's column, the card's end inset and the card's border, in pixels
 * (w-13 + me-1 + 2 × 1px): what the conversation can't have of the window.
 */
const RAIL_SPACE = 58;

/** The width the columns share: the window, less the rail beside them. */
const columnsViewport = (
  viewport: number | null,
  railed: boolean
): number | null =>
  viewport !== null && railed ? viewport - RAIL_SPACE : viewport;

// With a rail, the window shows around an inset card, as in ChatGPT: the rail
// stays on the window, everything else sits on the card.
const shellClass = (railed: boolean) =>
  railed ? "bg-window" : "bg-background";
const cardClass = (railed: boolean) =>
  railed
    ? "md:my-1 md:me-1 md:overflow-hidden md:rounded-xl md:border md:border-border/60 md:bg-background md:shadow-xs"
    : undefined;
const dockedSidebarClass = (railed: boolean) =>
  railed ? "border-border/60 border-e" : undefined;
const overlayPlaceClass = (railed: boolean) =>
  railed
    ? "inset-y-1 start-13 rounded-xl border"
    : "inset-y-0 start-0 border-e";

/** Where the sidebar goes when it shows. */
type SidebarPlace = "dock" | "overlay" | "sheet";

const sidebarPlace = (narrow: boolean, fits: boolean): SidebarPlace => {
  if (narrow) {
    return "sheet";
  }
  return fits ? "dock" : "overlay";
};

export function AppShell({
  children,
  claimSidebarToggle,
  className,
  header,
  onPanelClose,
  onPanelWidthChange,
  onSidebarSheetOpenChange,
  panel,
  panelOpen,
  panelWidth,
  platform = "web",
  rail,
  sidebar,
  sidebarOpen,
  sidebarSheetOpen,
}: AppShellProps) {
  const { t } = useLingui();
  const narrow = useNarrowScreen();
  const viewport = useViewportWidth();
  // One toast queue per shell (undo toasts), not a module-level singleton.
  const [toastManager] = useState(createToastManager);
  const sidebarId = useId();
  const panelId = useId();

  // A drag moves these every frame; the saved widths change on release.
  const savedSidebar = useSidebarWidth();
  const [liveSidebar, setLiveSidebar] = useState<number | null>(null);
  const [livePanel, setLivePanel] = useState<number | null>(null);
  const columns = fitShellColumns({
    panelOpen: panelOpen && !narrow,
    panelWidth: livePanel ?? panelWidth,
    sidebarOpen: sidebarOpen && !narrow,
    sidebarWidth: liveSidebar ?? savedSidebar.width ?? SIDEBAR_DEFAULT_WIDTH,
    viewport: columnsViewport(viewport, Boolean(rail) && !narrow),
  });
  const { save: saveSidebar } = savedSidebar;
  const endSidebarResize = useCallback(
    (width: number) => {
      saveSidebar(width);
      setLiveSidebar(null);
    },
    [saveSidebar]
  );
  const endPanelResize = useCallback(
    (width: number) => {
      onPanelWidthChange?.(width);
      setLivePanel(null);
    },
    [onPanelWidthChange]
  );

  const place = sidebarPlace(narrow, columns.sidebarFits);
  const overlayOpen = place === "overlay" && sidebarSheetOpen;

  useEffect(() => {
    if (place !== "overlay") {
      return;
    }
    claimSidebarToggle(() => onSidebarSheetOpenChange(!sidebarSheetOpen));
    return () => claimSidebarToggle(null);
  }, [claimSidebarToggle, onSidebarSheetOpenChange, place, sidebarSheetOpen]);

  // A sheet or overlay doesn't survive a change of place: the panel
  // squeezing the sidebar out mustn't bring it up on its own.
  const lastPlace = useRef(place);
  useEffect(() => {
    if (lastPlace.current !== place) {
      lastPlace.current = place;
      onSidebarSheetOpenChange(false);
    }
  }, [onSidebarSheetOpenChange, place]);

  // Focus goes into the overlay, so Esc and the arrows reach it, and back
  // when it closes (unless something else took it).
  const overlayRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!(overlayOpen && overlay)) {
      return;
    }
    const previous = document.activeElement;
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        onSidebarSheetOpenChange(false);
      }
    };
    overlay.addEventListener("keydown", closeOnEscape);
    overlay.focus();
    return () => {
      overlay.removeEventListener("keydown", closeOnEscape);
      const lost =
        document.activeElement === null ||
        document.activeElement === document.body;
      if (lost && previous instanceof HTMLElement) {
        previous.focus();
      }
    };
  }, [onSidebarSheetOpenChange, overlayOpen]);

  // Going back or forward closes the sheet, as picking a chat in it does.
  useEffect(() => {
    if (!sidebarSheetOpen) {
      return;
    }
    const close = () => onSidebarSheetOpenChange(false);
    window.addEventListener("popstate", close);
    return () => window.removeEventListener("popstate", close);
  }, [onSidebarSheetOpenChange, sidebarSheetOpen]);

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
      <SidebarDockedProvider value={!narrow && columns.sidebar !== null}>
        <SidebarRailedProvider value={!narrow && Boolean(rail)}>
          <SidebarShownProvider
            value={
              place === "dock" ? columns.sidebar !== null : sidebarSheetOpen
            }
          >
            <TooltipProvider>
              <Toaster toastManager={toastManager}>
                <div
                  className={cn(
                    // dvh follows the browser's collapsing toolbars, so the
                    // composer stays docked at the bottom of what's visible.
                    "flex h-dvh min-h-0 w-full overflow-hidden text-foreground",
                    shellClass(Boolean(rail)),
                    className
                  )}
                  data-slot="app-shell"
                >
                  <RailSlot rail={rail} />
                  <div
                    className={cn(
                      "flex min-h-0 min-w-0 flex-1",
                      cardClass(Boolean(rail))
                    )}
                    data-slot="app-shell-card"
                  >
                    {columns.sidebar === null ? null : (
                      <div
                        className="relative flex shrink-0 max-md:hidden"
                        data-slot="app-shell-sidebar"
                      >
                        <aside
                          aria-label={t`Chats`}
                          className={cn(
                            SIDEBAR_WIDTH_CLASS,
                            // Before the first measure, CSS keeps the conversation's
                            // minimum; after it, the width is exact.
                            "flex min-w-50 max-w-[max(12.5rem,calc(100vw-30rem))] flex-col bg-sidebar text-sidebar-foreground",
                            dockedSidebarClass(Boolean(rail))
                          )}
                          id={sidebarId}
                          style={
                            savedSidebar.width === null
                              ? undefined
                              : { width: columns.sidebar }
                          }
                        >
                          {sidebar}
                        </aside>
                        <ResizeHandle
                          aria-controls={sidebarId}
                          aria-label={t`Resize sidebar`}
                          defaultValue={SIDEBAR_DEFAULT_WIDTH}
                          max={columns.sidebarMax}
                          min={SIDEBAR_MIN_WIDTH}
                          onResize={setLiveSidebar}
                          onResizeEnd={endSidebarResize}
                          resizes="before"
                          step={RESIZE_KEY_STEP}
                          value={columns.sidebar}
                        />
                      </div>
                    )}
                    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
                      {header}
                      <main className="flex min-h-0 flex-1 flex-col">
                        {children}
                      </main>
                    </div>
                    {panelOpen && !narrow ? (
                      <div
                        className="relative flex shrink-0"
                        data-slot="app-shell-panel"
                      >
                        <ResizeHandle
                          aria-controls={panelId}
                          aria-label={t`Resize side panel`}
                          defaultValue={PANEL_DEFAULT_WIDTH}
                          max={columns.panelMax}
                          min={PANEL_MIN_WIDTH}
                          onResize={setLivePanel}
                          onResizeEnd={endPanelResize}
                          resizes="after"
                          step={RESIZE_KEY_STEP}
                          value={columns.panel}
                        />
                        <aside
                          aria-label={t`Side panel`}
                          className="flex h-full min-h-0 flex-col bg-background"
                          id={panelId}
                          style={{ width: columns.panel }}
                        >
                          {panel}
                        </aside>
                      </div>
                    ) : null}
                  </div>
                </div>
                {overlayOpen ? (
                  <aside
                    aria-label={t`Chats`}
                    className={cn(
                      SIDEBAR_WIDTH_CLASS,
                      // Over the page, not beside it: nothing moves. Opened
                      // by the toggle or a key, so it doesn't animate (D28).
                      overlayPlaceClass(Boolean(rail)),
                      "fixed z-40 flex max-w-[calc(100vw-3rem)] flex-col border-sidebar-border bg-sidebar text-sidebar-foreground shadow-lg outline-none max-md:hidden"
                    )}
                    data-slot="app-shell-sidebar-overlay"
                    ref={overlayRef}
                    tabIndex={-1}
                  >
                    {sidebar}
                  </aside>
                ) : null}
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
          </SidebarShownProvider>
        </SidebarRailedProvider>
      </SidebarDockedProvider>
    </PlatformProvider>
  );
}
