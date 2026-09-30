"use client";

import { useLingui } from "@lingui/react/macro";
import { ChevronLeftIcon } from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";
import { createContext, type ReactNode, useContext } from "react";

import { ClosePanelButton } from "../shell/right-panel";

// One header row per view (070): what's shown on the left, its actions on the
// right, then the panel's Close. The rows of the list and the main area are
// the same height and share one hairline, so the panel reads as a single
// header over its content; no card, no second title bar. On a narrow panel
// the list and the main area take turns, and the row starts with the way
// back to the list.

const BackToListContext = createContext<(() => void) | null>(null);

/** Gives the views the way back to the list on a narrow panel. */
export const BackToListProvider = BackToListContext.Provider;

/** The way back to the list, on a narrow panel; `null` when the list is in view. */
export const useBackToList = (): (() => void) | null =>
  useContext(BackToListContext);

/** Back to the list; only on a narrow panel, where the list is hidden. */
export function BackToList() {
  const { t } = useLingui();
  const back = useBackToList();
  if (!back) {
    return null;
  }
  return (
    <Button
      aria-label={t`Back to the list`}
      className="shrink-0"
      onClick={back}
      size="icon-sm"
      title={t`Back to the list`}
      variant="ghost"
    >
      <ChevronLeftIcon aria-hidden />
    </Button>
  );
}

/** The header row's frame: the same height and hairline in every view. */
// 48px, the app header's height, so the panel's hairline continues its line.
export const headerRow = "flex h-12 shrink-0 items-center gap-1 border-b px-2";

export function ViewHeader({
  actions,
  children,
  className,
}: {
  readonly actions?: ReactNode;
  /** The title: a path, an artifact's name. */
  readonly children?: ReactNode;
  readonly className?: string;
}) {
  return (
    <div className={cn(headerRow, className)} data-slot="workspace-header">
      <BackToList />
      <div className="flex min-w-0 flex-1 items-center gap-2 ps-1">
        {children}
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-1">{actions}</div>
      ) : null}
      <ClosePanelButton />
    </div>
  );
}

/** A workspace path as a title: the folder quiet, the name in full. */
export function PathTitle({ path }: { readonly path: string }) {
  const slash = path.lastIndexOf("/");
  return (
    <span className="min-w-0 truncate text-sm" title={path}>
      <span className="text-muted-foreground">{path.slice(0, slash + 1)}</span>
      <span className="font-medium">{path.slice(slash + 1)}</span>
    </span>
  );
}
