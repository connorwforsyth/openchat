"use client";

import { useLingui } from "@lingui/react/macro";
import type {
  FileTreeDropContext,
  FileTreeDropResult,
  FileTreeInitialExpansion,
  FileTreeRenameEvent,
  GitStatusEntry,
} from "@pierre/trees";
import {
  FileTree as TreeHost,
  useFileTree,
  useFileTreeSearch,
} from "@pierre/trees/react";
import { SearchIcon } from "@workspace/icons";
import { cn } from "@workspace/ui/lib/utils";
import {
  type ChangeEvent,
  type CSSProperties,
  type KeyboardEvent,
  type Ref,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";

import { TreeIconSprite, treeIconRules } from "./icons/tree-icons";
import { treeHostStyle } from "./theme/host-styles";
import { useCodeThemeType } from "./theme/use-code-theme-type";

export type { GitStatus, GitStatusEntry } from "@pierre/trees";

/** What a host can do to the tree from outside. */
export interface FileTreeHandle {
  /** Moves focus to the selected row (else the current or first); false when there are no rows. */
  readonly focus: () => boolean;
}

// Selection is the row's fill. The library also outlines the focused row,
// which after a click is the selected one, so a selection read as fill plus
// ring (070). Keep the ring for keyboard focus only.
const TREE_CSS = `[data-type="item"]:not(:focus-visible)::before { outline-color: transparent; }`;

// A flush tree sits straight on the host's surface: no card, and neither the
// host nor the rows' backdrop (sticky folders, truncation fades) paints the
// code theme's sidebar colour, which read as a grey slab (070).
const FLUSH_STYLE = {
  "--trees-bg-override": "var(--background)",
  // Rows line up with the host's own list items.
  "--trees-padding-inline-override": "8px",
  backgroundColor: "var(--background)",
} as CSSProperties;

export interface FileTreeProps {
  /** Allows a drop; the tree only moves paths when this returns true. */
  readonly canDrop?: (context: FileTreeDropContext) => boolean;
  readonly className?: string;
  readonly gitStatus?: readonly GitStatusEntry[];
  readonly initialExpansion?: FileTreeInitialExpansion;
  /** Accessible name of the tree. */
  readonly label?: string;
  /** A drag-and-drop move finished. Omit to disable dragging. */
  readonly onMove?: (event: FileTreeDropResult) => void;
  /** An inline rename finished. Omit to disable renaming. */
  readonly onRename?: (event: FileTreeRenameEvent) => void;
  readonly onSelectionChange?: (paths: readonly string[]) => void;
  /** Directory paths end with `/`; file paths don't. */
  readonly paths: readonly string[];
  readonly ref?: Ref<FileTreeHandle>;
  /** Shows the search field. */
  readonly search?: boolean;
  /**
   * The path the host has open, when it controls selection: the tree selects
   * it, and clears its own selection when it's `null`, so clicking the same
   * row again (after the host showed something else) selects it anew.
   * Omitted, selection is the tree's own.
   */
  readonly selectedPath?: string | null;
  readonly style?: CSSProperties;
  /**
   * `card` (the default) frames the tree in its own bordered surface;
   * `flush` leaves framing to the host (the Workspace panel's list).
   */
  readonly variant?: "card" | "flush";
}

/** Keeps the latest callback without recreating the tree model. */
function useLatest<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}

/**
 * A virtualised file tree over @pierre/trees: git-status decorations, search,
 * rename and drag-and-drop, themed from the `packages/ui` tokens and drawn
 * with the active icon set.
 */
export function FileTree({
  canDrop,
  className,
  gitStatus,
  initialExpansion = 1,
  label,
  onMove,
  onRename,
  onSelectionChange,
  paths,
  ref,
  search = true,
  selectedPath,
  style,
  variant = "card",
}: FileTreeProps) {
  const { t } = useLingui();
  const { scheme } = useCodeThemeType();
  const callbacks = useLatest({ canDrop, onMove, onRename, onSelectionChange });

  // Options are read once, when the model is created (the trees skill: create
  // the model once, then call its methods). Callbacks go through a ref so the
  // model always reaches the latest ones.
  const { model } = useFileTree({
    dragAndDrop: onMove
      ? {
          canDrop: (context) => callbacks.current.canDrop?.(context) ?? true,
          onDropComplete: (event) => callbacks.current.onMove?.(event),
        }
      : false,
    gitStatus,
    icons: treeIconRules,
    initialExpansion,
    onSelectionChange: (selected) =>
      callbacks.current.onSelectionChange?.(selected),
    paths,
    renaming: onRename
      ? { onRename: (event) => callbacks.current.onRename?.(event) }
      : false,
    stickyFolders: true,
    unsafeCSS: TREE_CSS,
  });

  useImperativeHandle(
    ref,
    () => ({
      focus: () => {
        const root = model.getFileTreeContainer()?.shadowRoot;
        const row =
          root?.querySelector<HTMLElement>(
            '[role="treeitem"][data-item-selected="true"]'
          ) ??
          root?.querySelector<HTMLElement>('[role="treeitem"][tabindex="0"]') ??
          root?.querySelector<HTMLElement>('[role="treeitem"]');
        row?.focus();
        return Boolean(row);
      },
    }),
    [model]
  );

  // Later prop changes go through the model's methods.
  const firstPaths = useRef(paths);
  useEffect(() => {
    if (paths !== firstPaths.current) {
      model.resetPaths(paths);
    }
  }, [model, paths]);

  // `paths` is a dependency: a reset can drop the selection or bring the
  // selected path into the tree.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above.
  useEffect(() => {
    if (selectedPath === undefined) {
      return;
    }
    for (const path of model.getSelectedPaths()) {
      if (path !== selectedPath) {
        model.getItem(path)?.deselect();
      }
    }
    const item = selectedPath === null ? null : model.getItem(selectedPath);
    if (item && !item.isSelected()) {
      item.select();
    }
  }, [model, paths, selectedPath]);

  const firstGitStatus = useRef(gitStatus);
  useEffect(() => {
    if (gitStatus !== firstGitStatus.current) {
      model.setGitStatus(gitStatus);
    }
  }, [model, gitStatus]);

  const applySprite = useCallback(
    (sprite: string) =>
      model.setIcons({ ...treeIconRules, spriteSheet: sprite }),
    [model]
  );

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col overflow-hidden",
        variant === "card" && "rounded-lg border bg-sidebar",
        className
      )}
      data-variant={variant}
    >
      <TreeIconSprite onSprite={applySprite} />
      {search ? <TreeSearch model={model} /> : null}
      <TreeHost
        aria-label={label ?? t`Files`}
        className="min-h-0 flex-1"
        model={model}
        style={{
          ...treeHostStyle(scheme),
          ...(variant === "flush" ? FLUSH_STYLE : null),
          ...style,
        }}
      />
    </div>
  );
}

function TreeSearch({
  model,
}: {
  readonly model: Parameters<typeof useFileTreeSearch>[0];
}) {
  const { t } = useLingui();
  const search = useFileTreeSearch(model);
  const { close, focusNextMatch, focusPreviousMatch, setValue } = search;

  const onChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) =>
      setValue(event.target.value || null),
    [setValue]
  );
  // Enter walks the matches (Shift+Enter backwards); Escape ends the search.
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        if (event.shiftKey) {
          focusPreviousMatch();
        } else {
          focusNextMatch();
        }
      } else if (event.key === "Escape") {
        close();
      }
    },
    [close, focusNextMatch, focusPreviousMatch]
  );

  return (
    <div className="flex items-center gap-2 border-b px-2.5 py-1.5 text-sm">
      <SearchIcon aria-hidden className="size-3.5 text-muted-foreground" />
      <input
        aria-label={t`Search files`}
        className="h-6 w-full min-w-0 bg-transparent outline-none placeholder:text-muted-foreground"
        onChange={onChange}
        onKeyDown={onKeyDown}
        placeholder={t`Search files`}
        type="search"
        value={search.value}
      />
    </div>
  );
}
