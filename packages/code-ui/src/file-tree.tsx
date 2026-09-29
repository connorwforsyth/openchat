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
  useCallback,
  useEffect,
  useRef,
} from "react";

import { TreeIconSprite, treeIconRules } from "./icons/tree-icons";
import { treeHostStyle } from "./theme/host-styles";
import { useCodeThemeType } from "./theme/use-code-theme-type";

export type { GitStatus, GitStatusEntry } from "@pierre/trees";

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
  search = true,
  selectedPath,
  style,
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
  });

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
        "flex min-h-0 flex-col overflow-hidden rounded-lg border bg-sidebar",
        className
      )}
    >
      <TreeIconSprite onSprite={applySprite} />
      {search ? <TreeSearch model={model} /> : null}
      <TreeHost
        aria-label={label ?? t`Files`}
        className="min-h-0 flex-1"
        model={model}
        style={{ ...treeHostStyle(scheme), ...style }}
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
