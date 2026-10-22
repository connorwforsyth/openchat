"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { PanelLeftIcon } from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import {
  createContext,
  type ReactNode,
  useContext,
  useSyncExternalStore,
} from "react";

// Where the sidebar toggle sits. With the icon rail showing (181) it is the
// rail's first button and never moves, open or collapsed, as in ChatGPT.
// Without a rail (113): in the sidebar's own top row while the sidebar is
// docked beside the page, and at the start of the header while it isn't
// (collapsed, squeezed out by the panel, or a narrow screen's sheet). The
// shell knows which, and whether the sidebar is showing at all, and says so
// through these contexts.

const SidebarDockedContext = createContext(false);
const SidebarRailedContext = createContext(false);
const SidebarShownContext = createContext(false);

export const SidebarDockedProvider = SidebarDockedContext.Provider;
export const SidebarRailedProvider = SidebarRailedContext.Provider;
export const SidebarShownProvider = SidebarShownContext.Provider;

/** Whether the sidebar is docked beside the page right now. */
export const useSidebarDocked = (): boolean => useContext(SidebarDockedContext);

/** Whether the icon rail is showing, and so holds the toggle. */
export const useSidebarRailed = (): boolean => useContext(SidebarRailedContext);

/** The rail's 36px button, shared by its items and the toggle (181). */
export const railButtonClass = cn(
  "relative flex size-9 items-center justify-center rounded-xl text-muted-foreground outline-none",
  "transition-colors duration-(--motion-fast) hover:bg-foreground/5 hover:text-sidebar-foreground",
  "focus-visible:ring-2 focus-visible:ring-sidebar-ring",
  "aria-[current=page]:bg-foreground/8 aria-[current=page]:text-sidebar-foreground",
  "[&_svg]:size-4.5"
);

const noSubscription = () => () => undefined;

/** False while rendering on the server and hydrating, true after. */
const useHydrated = (): boolean =>
  useSyncExternalStore(
    noSubscription,
    () => true,
    () => false
  );

export interface SidebarToggleProps {
  /** The shortcut, shown in the tooltip. */
  readonly hint?: ReactNode;
  readonly onToggle: () => void;
  /**
   * `rail` always shows it, as the rail's first button. `header` hides it
   * while the rail or the docked sidebar holds the toggle; `sidebar` hides
   * it while the rail does.
   */
  readonly placement: "header" | "rail" | "sidebar";
}

export function SidebarToggle({
  hint,
  onToggle,
  placement,
}: SidebarToggleProps) {
  const { t } = useLingui();
  const docked = useSidebarDocked();
  const railed = useSidebarRailed();
  const expanded = useContext(SidebarShownContext);
  const hydrated = useHydrated();
  if (placement === "rail") {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              aria-expanded={expanded}
              aria-label={t`Toggle sidebar`}
              className={railButtonClass}
              onClick={onToggle}
              type="button"
            />
          }
        >
          <PanelLeftIcon aria-hidden />
        </TooltipTrigger>
        <TooltipContent side="right">
          <Trans>Toggle sidebar</Trans>
          {hint}
        </TooltipContent>
      </Tooltip>
    );
  }
  const button = (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-expanded={expanded}
            aria-label={t`Toggle sidebar`}
            // Quiet: it says open or closed by where it sits, not by a fill.
            className={cn(
              "shrink-0 aria-expanded:bg-transparent",
              placement === "sidebar"
                ? "text-muted-foreground hover:bg-sidebar-foreground/5 hover:text-sidebar-foreground aria-expanded:text-muted-foreground aria-expanded:hover:bg-sidebar-foreground/5 aria-expanded:hover:text-sidebar-foreground dark:hover:bg-sidebar-foreground/5"
                : "aria-expanded:hover:bg-muted"
            )}
            onClick={onToggle}
            size="icon-sm"
            variant="ghost"
          />
        }
      >
        <PanelLeftIcon aria-hidden />
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <Trans>Toggle sidebar</Trans>
        {hint}
      </TooltipContent>
    </Tooltip>
  );
  if (placement === "sidebar") {
    return railed ? null : button;
  }
  if (!(docked || railed)) {
    return button;
  }
  // Before hydration the shell can't know the width, so a phone gets the
  // wide layout; CSS keeps the header's toggle there until it knows.
  return hydrated ? null : <div className="flex md:hidden">{button}</div>;
}
