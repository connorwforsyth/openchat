"use client";

import { useCallback, useMemo, useRef, useState } from "react";

import {
  canRedo,
  canUndo,
  type History,
  record,
  redo,
  startHistory,
  undo,
} from "./history";

// An editor's undo history as React state (`./history`), and the keys that
// drive it. Undo and redo hand back the value to show and save; the editor
// decides what showing it means.

export interface EditorHistory<T> {
  readonly canRedo: boolean;
  readonly canUndo: boolean;
  /** `next` as a step; `key` folds quick edits to one field into one. */
  readonly record: (next: T, key?: string) => void;
  /** Steps forward again; the value to show, or `null` with nothing to redo. */
  readonly redo: () => T | null;
  /** Starts over from `present`, with nothing to undo. */
  readonly reset: (present: T) => void;
  /** Steps back; the value to show, or `null` with nothing to undo. */
  readonly undo: () => T | null;
}

export function useEditorHistory<T>(
  initial: T,
  now: () => number = Date.now
): EditorHistory<T> {
  const [history, setHistory] = useState<History<T>>(() =>
    startHistory(initial)
  );
  // The callbacks read and write the latest history without re-subscribing.
  const latest = useRef(history);
  const commit = useCallback((next: History<T>) => {
    latest.current = next;
    setHistory(next);
  }, []);

  const step = useCallback(
    (move: (history: History<T>) => History<T>) => {
      const before = latest.current;
      const after = move(before);
      if (after === before) {
        return null;
      }
      commit(after);
      return after.present;
    },
    [commit]
  );

  return useMemo(
    () => ({
      canRedo: canRedo(history),
      canUndo: canUndo(history),
      record: (next: T, key?: string) =>
        commit(record(latest.current, next, { at: now(), key })),
      redo: () => step(redo),
      reset: (present: T) => commit(startHistory(present)),
      undo: () => step(undo),
    }),
    [commit, history, now, step]
  );
}

/** What undo and redo keys do: ⌘Z / Ctrl+Z, ⇧⌘Z / Ctrl+Y. */
export const undoKeyAction = (event: {
  readonly ctrlKey: boolean;
  readonly key: string;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
}): "redo" | "undo" | null => {
  if (!(event.metaKey || event.ctrlKey)) {
    return null;
  }
  const key = event.key.toLowerCase();
  if (key === "z") {
    return event.shiftKey ? "redo" : "undo";
  }
  return key === "y" && event.ctrlKey ? "redo" : null;
};

const TYPING = "input, textarea, select, [contenteditable]";

/**
 * A `keydown` listener for an editor's root: undo and redo, unless the
 * person is typing in a field, whose own undo comes first.
 */
export const useUndoKeys = ({
  onRedo,
  onUndo,
}: {
  readonly onRedo: () => void;
  readonly onUndo: () => void;
}) =>
  useCallback(
    (event: KeyboardEvent) => {
      const action = undoKeyAction(event);
      if (
        action === null ||
        (event.target instanceof Element && event.target.closest(TYPING))
      ) {
        return;
      }
      event.preventDefault();
      if (action === "undo") {
        onUndo();
      } else {
        onRedo();
      }
    },
    [onRedo, onUndo]
  );
