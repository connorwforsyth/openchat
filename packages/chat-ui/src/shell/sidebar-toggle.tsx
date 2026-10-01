"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { PanelLeftIcon } from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import {
  createContext,
  type ReactNode,
  useContext,
  useSyncExternalStore,
} from "react";

// Where the sidebar toggle sits (113): in the sidebar's own top row while
// the sidebar is docked beside the page, and at the start of the header
// while it isn't (collapsed, squeezed out by the panel, or a narrow
// screen's sheet). The shell knows which, and says so through this context.

const SidebarDockedContext = createContext(false);

export const SidebarDockedProvider = SidebarDockedContext.Provider;

/** Whether the sidebar is docked beside the page right now. */
export const useSidebarDocked = (): boolean => useContext(SidebarDockedContext);

const noSubscription = () => () => undefined;

/** False while rendering on the server and hydrating, true after. */
const useHydrated = (): boolean =>
  useSyncExternalStore(
    noSubscription,
    () => true,
    () => false
  );

export interface SidebarToggleProps {
  /** The sidebar is showing (docked, or a narrow screen's sheet open). */
  readonly expanded: boolean;
  /** The shortcut, shown in the tooltip. */
  readonly hint?: ReactNode;
  readonly onToggle: () => void;
  /**
   * `header` hides it while the sidebar is docked, where the sidebar's own
   * toggle takes over; `sidebar` always shows it.
   */
  readonly placement: "header" | "sidebar";
}

export function SidebarToggle({
  expanded,
  hint,
  onToggle,
  placement,
}: SidebarToggleProps) {
  const { t } = useLingui();
  const docked = useSidebarDocked();
  const hydrated = useHydrated();
  const button = (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-expanded={expanded}
            aria-label={t`Toggle sidebar`}
            className="shrink-0"
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
  if (placement === "sidebar" || !docked) {
    return button;
  }
  // Before hydration the shell can't know the width, so a phone gets the
  // wide layout; CSS keeps the header's toggle there until it knows.
  return hydrated ? null : <div className="flex md:hidden">{button}</div>;
}
