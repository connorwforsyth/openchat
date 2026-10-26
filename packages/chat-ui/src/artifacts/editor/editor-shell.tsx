"use client";

// Adapted from open-slide (https://github.com/open-slide/open-slide),
// packages/core/src/app/routes/slide.tsx and components/panel/editor-sidebar.tsx.
// MIT, Copyright (c) 2026 Yiwei Ho; see NOTICE.open-slide.

import { useLingui } from "@lingui/react/macro";
import {
  FileTextIcon,
  PanelLeftIcon,
  PanelRightIcon,
  RotateCcwIcon,
} from "@workspace/icons";
import { ShortcutKbd } from "@workspace/shortcuts/react/shortcut-kbd";
import { useShortcut } from "@workspace/shortcuts/react/use-shortcut";
import type { ShortcutId } from "@workspace/shortcuts/registry";
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
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";

import {
  type EditorPanel,
  type EditorPanels,
  editorPanelSchema,
  useEditorPanels,
} from "./panels";

// The frame every artifact editor sits in, shared by every kind: a
// toolbar, the sorter (the rail) at the start, the canvas, the inspector at
// the end, and under the canvas a drawer ("Change this") and the notes.
// The rail, the inspector and the notes can each be hidden, from the
// toolbar or by key, and stay as they were left (`./panels`); they show and
// hide at once (D28: toggled, not animated). It lays out by the width of
// the pane that hosts it, not the window, so it reads the same in the side
// panel and on the artifact's own page. The width is measured rather than queried
// with CSS container queries, which would make the editor the containing
// block of a deck presenting over the whole window.

/** How wide the editor's pane is, in the steps its layout changes at. */
type EditorWidth = "medium" | "narrow" | "wide";

const editorWidth = (pixels: number): EditorWidth => {
  if (pixels >= 768) {
    return "wide";
  }
  return pixels >= 480 ? "medium" : "narrow";
};

/**
 * The narrowest pane the inspector docks in, beside a slide still big
 * enough to pick on (about 280px with the rail shown). Narrower, it lies
 * over the canvas while something is picked.
 */
const INSPECTOR_DOCK_MIN = 640;

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
  const [docksInspector, setDocksInspector] = useState(false);
  useLayoutEffect(() => {
    if (!element) {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      if (entry) {
        setWidth(editorWidth(entry.contentRect.width));
        setDocksInspector(entry.contentRect.width >= INSPECTOR_DOCK_MIN);
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return { docksInspector, ref, width };
};

interface PanelsContextValue {
  /** The panels this editor has, in toolbar order. */
  readonly available: readonly EditorPanel[];
  readonly panels: EditorPanels;
  readonly toggle: (panel: EditorPanel) => void;
}

const PanelsContext = createContext<PanelsContextValue | null>(null);

/** The editor's panels, for a panel that hides itself (the notes). */
export const useShellPanels = () => useContext(PanelsContext);

const PANEL_SHORTCUTS: Readonly<Record<EditorPanel, ShortcutId>> = {
  inspector: "editor.inspector",
  notes: "editor.notes",
  rail: "editor.rail",
};

export function EditorShell({
  canvas,
  className,
  drawer,
  inspector,
  inspectorPlaceholder,
  notes,
  onKeyDown,
  rail,
  toolbar,
}: {
  readonly canvas: ReactNode;
  readonly className?: string;
  /** Under the canvas, always shown ("Change this"). */
  readonly drawer?: ReactNode;
  /** What's picked, to change it; `null` when nothing is. */
  readonly inspector?: ReactNode;
  /** The docked inspector while nothing is picked ("Pick an element"). */
  readonly inspectorPlaceholder?: ReactNode;
  /** Notes on the piece being edited, under the drawer. */
  readonly notes?: ReactNode;
  /** Keys for the whole editor (undo, redo). */
  readonly onKeyDown?: (event: KeyboardEvent) => void;
  readonly rail?: ReactNode;
  readonly toolbar: ReactNode;
}) {
  const { docksInspector, ref, width } = useEditorWidth(onKeyDown);
  const { panels, toggle } = useEditorPanels();
  const hasRail = Boolean(rail);
  const hasInspector = Boolean(inspector ?? inspectorPlaceholder);
  const hasNotes = Boolean(notes);
  useShortcut("editor.rail", () => toggle("rail"), { enabled: hasRail });
  useShortcut("editor.inspector", () => toggle("inspector"), {
    enabled: hasInspector,
  });
  useShortcut("editor.notes", () => toggle("notes"), { enabled: hasNotes });
  const context = useMemo((): PanelsContextValue => {
    const has: Readonly<Record<EditorPanel, boolean>> = {
      inspector: hasInspector,
      notes: hasNotes,
      rail: hasRail,
    };
    return {
      available: editorPanelSchema.options.filter((panel) => has[panel]),
      panels,
      toggle,
    };
  }, [hasInspector, hasNotes, hasRail, panels, toggle]);
  const inspectorBody = docksInspector
    ? (inspector ?? inspectorPlaceholder)
    : inspector;
  return (
    <PanelsContext.Provider value={context}>
      <div
        className={cn("group/editor flex min-h-0 flex-1 flex-col", className)}
        data-artifact-editor=""
        data-width={width}
        ref={ref}
      >
        {toolbar}
        <div className="flex min-h-0 flex-1">
          {rail && panels.rail ? (
            <div
              className="flex w-24 shrink-0 border-e bg-muted/30 group-data-[width=medium]/editor:w-32 group-data-[width=wide]/editor:w-40"
              data-editor-panel="rail"
            >
              {rail}
            </div>
          ) : null}
          <div className="relative flex min-w-0 flex-1">
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <div className="flex min-h-0 flex-1 flex-col overflow-auto">
                {canvas}
              </div>
              {drawer}
              {panels.notes ? notes : null}
            </div>
            {inspectorBody && panels.inspector ? (
              <aside
                className={cn(
                  "flex min-h-0 w-60 shrink-0 flex-col border-s bg-background group-data-[width=wide]/editor:w-64",
                  !docksInspector &&
                    "absolute inset-y-0 end-0 z-10 max-w-[85%] shadow-lg"
                )}
                data-editor-panel="inspector"
              >
                {inspectorBody}
              </aside>
            ) : null}
          </div>
        </div>
      </div>
    </PanelsContext.Provider>
  );
}

/** A show-or-hide button for each panel the editor has. */
function PanelToggles() {
  const { t } = useLingui();
  const context = useContext(PanelsContext);
  if (!context || context.available.length === 0) {
    return null;
  }
  const labels: Readonly<Record<EditorPanel, string>> = {
    inspector: t`Inspector`,
    notes: t`Notes`,
    rail: t`Thumbnails`,
  };
  return (
    <div className="ms-1 flex shrink-0 items-center gap-0.5 border-s ps-1">
      {context.available.map((panel) => (
        <PanelToggle
          key={panel}
          label={labels[panel]}
          onToggle={context.toggle}
          panel={panel}
          shown={context.panels[panel]}
        />
      ))}
    </div>
  );
}

const PANEL_ICONS: Readonly<Record<EditorPanel, ReactNode>> = {
  inspector: <PanelRightIcon aria-hidden />,
  notes: <FileTextIcon aria-hidden />,
  rail: <PanelLeftIcon aria-hidden />,
};

function PanelToggle({
  label,
  onToggle,
  panel,
  shown,
}: {
  readonly label: string;
  readonly onToggle: (panel: EditorPanel) => void;
  readonly panel: EditorPanel;
  readonly shown: boolean;
}) {
  const toggle = useCallback(() => onToggle(panel), [onToggle, panel]);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={label}
            aria-pressed={shown}
            className="text-muted-foreground aria-pressed:text-foreground"
            onClick={toggle}
            size="icon-sm"
            variant="ghost"
          />
        }
      >
        {PANEL_ICONS[panel]}
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {label}
        <ShortcutKbd id={PANEL_SHORTCUTS[panel]} />
      </TooltipContent>
    </Tooltip>
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
      <PanelToggles />
    </div>
  );
}
