import type { PanelHalf, WorkspaceSelection } from "../../model/workspace";
import { type FileMode, isHtmlPath } from "./browser";

// The Workspace panel as two halves (097): the browser on top, the files
// (the list beside the open file) below, with a divider between them. Pure,
// so the rules are tested without rendering: how high the browser is, which
// halves show at a width, and which half a narrow panel shows after a pick.

/** Below this panel width the halves take turns instead of stacking. */
export const SPLIT_BELOW = 420;

/** Below this width (the old `@lg`, 32rem) the list and the open file take turns. */
export const LIST_BESIDE_FROM = 512;

/** Neither half gets shorter than this: a header row and a little content. */
export const MIN_PANE_HEIGHT = 120;

/** The browser's share of the height until someone moves the divider. */
export const SPLIT_DEFAULT = 0.5;

/** How far one ↑/↓ press moves the divider, as the sidebar's ←/→ does (071). */
export const SPLIT_KEY_STEP = 16;

/** Where the divider's position is kept (`localStorage`), per browser profile. */
export const SPLIT_STORAGE_KEY = "chat-ui:workspace-split";

const clampTo = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** The browser's smallest and largest share of `height` (px). */
export const splitBounds = (
  height: number
): { readonly max: number; readonly min: number } => {
  // Before a measure, or too short for both minimums: anything goes, and
  // the panes' own `min-height` sorts it out.
  if (height <= 2 * MIN_PANE_HEIGHT) {
    return { max: 1, min: 0 };
  }
  const min = MIN_PANE_HEIGHT / height;
  return { max: 1 - min, min };
};

/** Keeps a share inside what `height` allows; a share that isn't one is the default. */
export const clampSplit = (fraction: number, height = 0): number => {
  const { max, min } = splitBounds(height);
  const share = Number.isFinite(fraction)
    ? clampTo(fraction, 0, 1)
    : SPLIT_DEFAULT;
  // Three places are plenty for a pixel on any panel.
  return Math.round(clampTo(share, min, max) * 1000) / 1000;
};

/** Reads a stored share; anything unreadable is the default. */
export const parseSplit = (raw: string | null): number => {
  const value = raw === null || raw.trim() === "" ? Number.NaN : Number(raw);
  return Number.isFinite(value) && value > 0 && value < 1
    ? clampSplit(value)
    : SPLIT_DEFAULT;
};

/** A half someone made take the whole height, until they restore it. */
export type Maximised = "browser" | "files" | null;

/** What a narrow panel shows: the list, the open file or the browser. */
export type TurnView = "browser" | "list" | "main";

/** The halves and columns on screen. */
export interface PaneLayout {
  /** The browser half. */
  readonly browser: boolean;
  /** The divider between the halves. */
  readonly divider: boolean;
  /** The files half. */
  readonly files: boolean;
  /** Within the files half, the list. */
  readonly list: boolean;
  /** The list and the open file take turns (070). */
  readonly listAlone: boolean;
  /** Within the files half, the open file (or artifact). */
  readonly main: boolean;
  /** Either half can be maximised (the halves are stacked). */
  readonly maximisable: boolean;
  /** The halves take turns. */
  readonly turns: boolean;
}

/**
 * Which halves show. With nothing to preview the files take the whole
 * height. A panel under `SPLIT_BELOW` shows one half at a time, by its turn;
 * otherwise they stack, unless one is maximised. A panel under
 * `LIST_BESIDE_FROM` shows the list or the open file, not both (070).
 */
export const paneLayout = ({
  filesSelected,
  hasPreview,
  maximised,
  view,
  width,
}: {
  /** The files half has something open. */
  readonly filesSelected: boolean;
  readonly hasPreview: boolean;
  readonly maximised: Maximised;
  readonly view: TurnView;
  /** The panel's width; 0 before it's measured (laid out as wide). */
  readonly width: number;
}): PaneLayout => {
  const measured = width > 0;
  const turns = hasPreview && measured && width < SPLIT_BELOW;
  const stacked = hasPreview && !turns;
  const browser = turns ? view === "browser" : stacked && maximised !== "files";
  const files = turns
    ? view !== "browser"
    : !(stacked && maximised === "browser");
  const listAlone = measured && width < LIST_BESIDE_FROM;
  // Beside each other, both; taking turns, the list unless a file is open
  // and it's the file's turn (the browser's turn, when stacked, leaves the
  // file below in view).
  const main = listAlone ? view !== "list" && filesSelected : true;
  return {
    browser,
    divider: browser && files,
    files,
    list: listAlone ? !main : true,
    listAlone,
    main,
    maximisable: stacked,
    turns,
  };
};

/**
 * The view a pick asks for on a narrow panel: the browser for the Preview
 * and for an HTML file (it opens in the browser, unless it was switched to
 * its code), the file for anything else, the list for nothing.
 */
export const viewOf = (
  selection: WorkspaceSelection | null,
  modes: Readonly<Record<string, FileMode>>
): TurnView => {
  switch (selection?.kind) {
    case undefined:
      return "list";
    case "preview":
      return "browser";
    case "file":
      return isHtmlPath(selection.path) && modes[selection.path] !== "code"
        ? "browser"
        : "main";
    case "artifact":
      return "main";
    default:
      return selection satisfies never;
  }
};

/**
 * What a new pick does to a maximised half: the browser's picks (the
 * Preview, an HTML file) bring the browser back, and any other file or
 * artifact brings the files back, so what was picked is on screen.
 */
export const maximisedAfter = (
  maximised: Maximised,
  selection: WorkspaceSelection | null
): Maximised => {
  if (maximised === null || selection === null) {
    return maximised;
  }
  const forBrowser = viewOf(selection, {}) === "browser";
  if (forBrowser && maximised === "files") {
    return null;
  }
  return !forBrowser && maximised === "browser" ? null : maximised;
};

/**
 * The header asking for one half (137): Browser for the browser, Files for
 * the files. `id` moves with each press, so pressing again asks again.
 */
export interface HalfRequest {
  readonly half: PanelHalf;
  readonly id: number;
}

/**
 * What a header press does to a maximised half: Browser gives the browser
 * the whole height (its empty state, before there's a preview); Files brings
 * the files back if the browser had it, and leaves them as they were otherwise.
 */
export const maximisedForHalf = (
  maximised: Maximised,
  half: PanelHalf
): Maximised => {
  if (half === "browser") {
    return "browser";
  }
  return maximised === "browser" ? null : maximised;
};

/** Whose turn a header press makes it on a narrow panel. */
export const viewForHalf = (
  half: PanelHalf,
  filesSelected: boolean
): TurnView => {
  if (half === "browser") {
    return "browser";
  }
  return filesSelected ? "main" : "list";
};
