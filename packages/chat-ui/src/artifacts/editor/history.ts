// Adapted from open-slide (https://github.com/open-slide/open-slide),
// packages/core/src/app/components/history-provider.tsx. MIT, Copyright (c)
// 2026 Yiwei Ho; see NOTICE.open-slide.

// Undo and redo for an artifact editor, shared by every kind. open-slide
// keeps undo/redo callbacks; an artifact here is one value (a deck, a
// sheet), so the history keeps the values themselves: undoing is showing
// the one before and saving it. Edits with the same key close together
// (typing in one field) are one step, as in open-slide. Pure.

/** Edits with one key this close together undo as one. */
export const COALESCE_MS = 500;

/** How many steps back undo goes. */
export const HISTORY_LIMIT = 100;

export interface History<T> {
  /** When the present was recorded, for coalescing. */
  readonly at: number;
  readonly future: readonly T[];
  /** The present's coalescing key, if it has one. */
  readonly key: string | null;
  readonly past: readonly T[];
  readonly present: T;
}

/** A history with nothing to undo. */
export const startHistory = <T>(present: T): History<T> => ({
  at: 0,
  future: [],
  key: null,
  past: [],
  present,
});

/**
 * `next` as the present. With the same `key` as the present, recorded
 * within `COALESCE_MS`, it replaces the present instead of adding a step.
 * Any redo is gone.
 */
export const record = <T>(
  history: History<T>,
  next: T,
  { at, key = null }: { readonly at: number; readonly key?: string | null }
): History<T> => {
  if (next === history.present) {
    return history;
  }
  const coalesce =
    key !== null &&
    key === history.key &&
    history.past.length > 0 &&
    at - history.at < COALESCE_MS;
  return {
    at,
    future: [],
    key,
    past: coalesce
      ? history.past
      : [...history.past, history.present].slice(-HISTORY_LIMIT),
    present: next,
  };
};

export const canUndo = <T>(history: History<T>): boolean =>
  history.past.length > 0;

export const canRedo = <T>(history: History<T>): boolean =>
  history.future.length > 0;

/** The step before, or the same history when there's none. */
export const undo = <T>(history: History<T>): History<T> => {
  const previous = history.past.at(-1);
  if (previous === undefined) {
    return history;
  }
  return {
    at: 0,
    future: [history.present, ...history.future],
    key: null,
    past: history.past.slice(0, -1),
    present: previous,
  };
};

/** The step undone last, or the same history when there's none. */
export const redo = <T>(history: History<T>): History<T> => {
  const [next, ...rest] = history.future;
  if (next === undefined) {
    return history;
  }
  return {
    at: 0,
    future: rest,
    key: null,
    past: [...history.past, history.present],
    present: next,
  };
};
