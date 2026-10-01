"use client";

import { useLingui } from "@lingui/react/macro";
import { ChevronLeftIcon, Maximize2Icon } from "@workspace/icons";
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
//
// 097 split the panel into the browser over the files. The panel's Close
// ends the top row only, and each half's row has its Maximise; the row a
// view draws doesn't know which half it's in, so the half says (`RowEnd`).

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

/** A half's Maximise: pressed while that half has the whole height. */
export interface MaximiseControl {
  readonly label: string;
  readonly onToggle: () => void;
  readonly pressed: boolean;
}

/** What ends a header row in this half of the panel. */
export interface RowEnd {
  /** The panel's Close: only the top row has it. */
  readonly close: boolean;
  readonly maximise: MaximiseControl | null;
}

const RowEndContext = createContext<RowEnd>({ close: true, maximise: null });

/** Tells the views in one half of the panel how their header rows end. */
export const RowEndProvider = RowEndContext.Provider;

export const useRowEnd = (): RowEnd => useContext(RowEndContext);

/** The half's Maximise, then the panel's Close, as this half has them. */
export function RowEndActions() {
  const { t } = useLingui();
  const { close, maximise } = useRowEnd();
  return (
    <>
      {maximise ? (
        <Button
          aria-label={maximise.label}
          aria-pressed={maximise.pressed}
          className="shrink-0 aria-pressed:bg-muted"
          onClick={maximise.onToggle}
          size="icon-sm"
          title={maximise.pressed ? t`Restore` : maximise.label}
          variant="ghost"
        >
          <Maximize2Icon aria-hidden />
        </Button>
      ) : null}
      {close ? <ClosePanelButton /> : null}
    </>
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
      <RowEndActions />
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
