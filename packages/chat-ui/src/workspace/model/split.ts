import type { PanelHalf, WorkspaceSelection } from "../../model/workspace";
import { type FileMode, isHtmlPath } from "./browser";

// The Workspace panel as two halves (097): the preview on top (the open
// artifact, or the browser), the files viewer below (the file list beside
// the open file, night 2), with a divider between them. Pure, so the rules
// are tested without rendering: how high the preview is, which halves show
// at a width, which half a narrow panel shows after a pick, and how wide
// the file list is. The "browser" half's name predates artifacts in it.

/** Below this panel width the halves take turns instead of stacking. */
export const SPLIT_BELOW = 420;

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

/** What a narrow panel shows: the browser or the files. */
export type TurnView = "browser" | "files";

/** The halves on screen. */
export interface PaneLayout {
  /** The browser half. */
  readonly browser: boolean;
  /** The divider between the halves. */
  readonly divider: boolean;
  /** The files half: what's open, over the file list. */
  readonly files: boolean;
  /** Either half can be maximised (the halves are stacked). */
  readonly maximisable: boolean;
  /** The halves take turns. */
  readonly turns: boolean;
}

/**
 * Which halves show. With nothing to preview the files take the whole
 * height. A panel under `SPLIT_BELOW` shows one half at a time, by its turn;
 * otherwise they stack, unless one is maximised.
 */
export const paneLayout = ({
  hasPreview,
  maximised,
  view,
  width,
}: {
  readonly hasPreview: boolean;
  readonly maximised: Maximised;
  readonly view: TurnView;
  /** The panel's width; 0 before it's measured (laid out as wide). */
  readonly width: number;
}): PaneLayout => {
  const turns = hasPreview && width > 0 && width < SPLIT_BELOW;
  const stacked = hasPreview && !turns;
  const browser = turns ? view === "browser" : stacked && maximised !== "files";
  const files = turns
    ? view === "files"
    : !(stacked && maximised === "browser");
  return {
    browser,
    divider: browser && files,
    files,
    maximisable: stacked,
    turns,
  };
};

/**
 * The view a pick asks for on a narrow panel: the top half for an artifact,
 * the Preview and an HTML file (it opens in the browser, unless it was
 * switched to its code), the files for anything else.
 */
export const viewOf = (
  selection: WorkspaceSelection | null,
  modes: Readonly<Record<string, FileMode>>
): TurnView => {
  switch (selection?.kind) {
    case undefined:
      return "files";
    case "preview":
      return "browser";
    case "file":
      return isHtmlPath(selection.path) && modes[selection.path] !== "code"
        ? "browser"
        : "files";
    case "artifact":
      return "browser";
    default:
      return selection satisfies never;
  }
};

/**
 * What a new pick does to a maximised half: the top half's picks (an
 * artifact, the Preview, an HTML file) bring it back, and any other file
 * brings the files back, so what was picked is on screen.
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
export const viewForHalf = (half: PanelHalf): TurnView => half;

/** What the top half shows: an artifact, or the browser (the Preview). */
export type PreviewSlot = Extract<
  WorkspaceSelection,
  { readonly kind: "artifact" | "preview" }
>;

/**
 * What each half holds (night 2): the top its artifact or the browser, the
 * files viewer its open file. A pick fills its own half and leaves the
 * other alone, so an artifact and a file are open together.
 */
export interface PanelSlots {
  readonly file: Extract<WorkspaceSelection, { readonly kind: "file" }> | null;
  readonly preview: PreviewSlot | null;
}

/**
 * The halves after the chat's selection changes. Nothing selected closes
 * the file (it was deleted, or the chat moved off it), not the preview.
 */
export const slotsAfter = (
  slots: PanelSlots,
  selection: WorkspaceSelection | null
): PanelSlots => {
  switch (selection?.kind) {
    case undefined:
      return slots.file === null ? slots : { ...slots, file: null };
    case "file":
      return { ...slots, file: selection };
    case "artifact":
    case "preview":
      return { ...slots, preview: selection };
    default:
      return selection satisfies never;
  }
};

/** The file list's width until someone moves its edge, in px. */
export const LIST_WIDTH_DEFAULT = 208;

/** The narrowest the list gets, and the least the open file keeps beside it. */
export const LIST_WIDTH_MIN = 160;
export const INSPECTOR_MIN_WIDTH = 240;

/** The widest the list gets, whatever room there is. */
const LIST_WIDTH_MAX = 400;

/** Below this files-viewer width the list and the open file take turns. */
export const COLUMNS_BELOW = LIST_WIDTH_MIN + INSPECTOR_MIN_WIDTH + 80;

/** Where the list's width is kept (`localStorage`), per browser profile. */
export const LIST_WIDTH_STORAGE_KEY = "chat-ui:files-list-width";

/** The list's widest, given the files viewer's `width` (0 before a measure). */
export const listWidthMax = (width: number): number =>
  width <= 0
    ? LIST_WIDTH_MAX
    : clampTo(width - INSPECTOR_MIN_WIDTH, LIST_WIDTH_MIN, LIST_WIDTH_MAX);

/** Keeps a width inside what the files viewer's `width` allows. */
export const clampListWidth = (value: number, width = 0): number =>
  Math.round(
    clampTo(
      Number.isFinite(value) ? value : LIST_WIDTH_DEFAULT,
      LIST_WIDTH_MIN,
      listWidthMax(width)
    )
  );

/** Reads a stored width; anything unreadable is the default. */
export const parseListWidth = (raw: string | null): number => {
  const value = raw === null || raw.trim() === "" ? Number.NaN : Number(raw);
  return Number.isFinite(value) ? clampListWidth(value) : LIST_WIDTH_DEFAULT;
};
