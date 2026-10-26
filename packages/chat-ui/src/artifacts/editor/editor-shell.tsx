"use client";

// Adapted from open-slide (https://github.com/open-slide/open-slide),
// packages/core/src/app/routes/slide.tsx and components/panel/editor-sidebar.tsx.
// MIT, Copyright (c) 2026 Yiwei Ho; see NOTICE.open-slide.

import { useLingui } from "@lingui/react/macro";
import { RotateCcwIcon } from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";
import { type ReactNode, useEffect, useLayoutEffect, useState } from "react";

// The frame every artifact editor sits in, shared by every kind: a
// toolbar, the sorter at the start, the canvas, the inspector at the end,
// and a drawer under the canvas (notes, "Change this"). It lays out by the
// width of the pane that hosts it, not the window, so it reads the same in
// the side panel and on the artifact's own page: in a narrow pane the
// inspector sits under the canvas. The width is measured rather than
// queried with CSS container queries, which would make the editor the
// containing block of a deck presenting over the whole window.

/** How wide the editor's pane is, in the steps its layout changes at. */
type EditorWidth = "medium" | "narrow" | "wide";

const editorWidth = (pixels: number): EditorWidth => {
  if (pixels >= 768) {
    return "wide";
  }
  return pixels >= 480 ? "medium" : "narrow";
};

const useEditorWidth = (onKeyDown?: (event: KeyboardEvent) => void) => {
  const [element, ref] = useState<HTMLDivElement | null>(null);
  // The editor's own keys (undo, redo), for whatever inside has focus.
  useEffect(() => {
    if (!(element && onKeyDown)) {
      return;
    }
    element.addEventListener("keydown", onKeyDown);
    return () => element.removeEventListener("keydown", onKeyDown);
  }, [element, onKeyDown]);
  const [width, setWidth] = useState<EditorWidth>("medium");
  useLayoutEffect(() => {
    if (!element) {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      if (entry) {
        setWidth(editorWidth(entry.contentRect.width));
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return { ref, width };
};

export function EditorShell({
  canvas,
  className,
  drawer,
  inspector,
  onKeyDown,
  rail,
  toolbar,
}: {
  readonly canvas: ReactNode;
  readonly className?: string;
  readonly drawer?: ReactNode;
  /** What's picked, to change it; `null` when nothing is. */
  readonly inspector?: ReactNode;
  /** Keys for the whole editor (undo, redo). */
  readonly onKeyDown?: (event: KeyboardEvent) => void;
  readonly rail?: ReactNode;
  readonly toolbar: ReactNode;
}) {
  const { ref, width } = useEditorWidth(onKeyDown);
  return (
    <div
      className={cn("group/editor flex min-h-0 flex-1 flex-col", className)}
      data-artifact-editor=""
      data-width={width}
      ref={ref}
    >
      {toolbar}
      <div className="flex min-h-0 flex-1">
        {rail ? (
          <div className="flex w-24 shrink-0 border-e bg-muted/30 group-data-[width=medium]/editor:w-32 group-data-[width=wide]/editor:w-40">
            {rail}
          </div>
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col group-data-[width=wide]/editor:flex-row">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1 flex-col overflow-auto">
              {canvas}
            </div>
            {drawer}
          </div>
          {inspector ? (
            <aside className="flex max-h-[45%] min-h-0 shrink-0 flex-col border-t group-data-[width=wide]/editor:max-h-none group-data-[width=wide]/editor:w-64 group-data-[width=wide]/editor:border-s group-data-[width=wide]/editor:border-t-0">
              {inspector}
            </aside>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** The editor's toolbar: undo and redo, then what the kind adds. */
export function EditorToolbar({
  canRedo,
  canUndo,
  children,
  onRedo,
  onUndo,
  status,
}: {
  readonly canRedo: boolean;
  readonly canUndo: boolean;
  /** The kind's own buttons, at the end (Export, Present). */
  readonly children?: ReactNode;
  readonly onRedo: () => void;
  readonly onUndo: () => void;
  /** Whether edits are kept (`SaveStatus`, `OlderVersion`). */
  readonly status?: ReactNode;
}) {
  const { t } = useLingui();
  return (
    <div className="flex h-10 shrink-0 items-center gap-1 border-b px-2">
      <Button
        aria-label={t`Undo`}
        disabled={!canUndo}
        onClick={onUndo}
        size="icon-sm"
        title={t`Undo (⌘Z)`}
        variant="ghost"
      >
        <RotateCcwIcon aria-hidden />
      </Button>
      <Button
        aria-label={t`Redo`}
        disabled={!canRedo}
        onClick={onRedo}
        size="icon-sm"
        title={t`Redo (⇧⌘Z)`}
        variant="ghost"
      >
        <RotateCcwIcon aria-hidden className="-scale-x-100" />
      </Button>
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden ps-1">
        {status}
      </div>
      {children}
    </div>
  );
}
