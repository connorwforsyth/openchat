"use client";

import { cn } from "@workspace/ui/lib/utils";
import type { ReactNode } from "react";

import { usePlatform } from "../shell/platform";

// The top bar (D14), with no rule under it (113). The chat puts everything
// in two slots: start (the sidebar toggle while the sidebar is collapsed,
// title, context, branch switcher) and end (Share, Workspace). Pages
// with a centred title, like the library, add a centre slot. On desktop it
// doubles as the window's title bar: the whole bar drags the window, controls
// opt out, and it leaves room for the OS window controls.

export interface AppHeaderProps {
  readonly center?: ReactNode;
  readonly className?: string;
  readonly end?: ReactNode;
  readonly start?: ReactNode;
  /**
   * The header sits under the OS window controls (macOS traffic lights at
   * the start, Windows/Linux overlay buttons at the end), e.g. when the
   * sidebar that usually hosts them is collapsed.
   */
  readonly underWindowControls?: boolean;
}

const platformClass = {
  // Electron's `hiddenInset` traffic lights take about 72px.
  linux: "pe-36",
  mac: "ps-20",
  web: "",
  // `titleBarOverlay` controls on Windows take about 138px.
  win: "pe-36",
} as const;

export function AppHeader({
  center,
  className,
  end,
  start,
  underWindowControls = true,
}: AppHeaderProps) {
  const { platform } = usePlatform();
  const desktop = platform !== "web";
  return (
    <header
      className={cn(
        "grid h-12 shrink-0 items-center gap-2 px-2",
        // Without a centre the start slot takes the room, so a long title
        // truncates instead of pushing the end slot off screen.
        center === undefined
          ? "grid-cols-[minmax(0,1fr)_auto]"
          : "grid-cols-[auto_minmax(0,1fr)_auto]",
        underWindowControls && platformClass[platform],
        // The bar drags the window; anything you can click opts out.
        desktop &&
          "select-none [-webkit-app-region:drag] [app-region:drag] [&_:is(a,button,input,select,textarea,[role=button],[role=tab])]:[-webkit-app-region:no-drag] [&_:is(a,button,input,select,textarea,[role=button],[role=tab])]:[app-region:no-drag]",
        className
      )}
      data-platform={platform}
      data-slot="app-header"
    >
      <div className="flex min-w-0 items-center gap-1">{start}</div>
      {center === undefined ? null : (
        <div className="flex min-w-0 items-center justify-center gap-1">
          {center}
        </div>
      )}
      <div className="flex items-center justify-end gap-1">{end}</div>
    </header>
  );
}
