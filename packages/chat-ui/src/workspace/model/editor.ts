import type { SandboxFileEtag } from "@workspace/contract/schemas/sandbox";
import { err, ok, type Result } from "@workspace/shared/result";

import type { WorkspaceFileRead } from "./client";

// The open file in the Workspace panel, as a pure state machine: loading it,
// editing it, saving it with the version it was read at, and the conflict
// when the agent changed it first. The hook around it (`use-open-file.ts`)
// only does the I/O and the timers.

/** Saves wait for this long without typing (060). */
export const SAVE_IDLE_MS = 800;

/** Bigger files open read-only: the editor keeps the whole text in memory. */
export const MAX_EDITABLE_BYTES = 1024 * 1024;

export type SaveState =
  | { readonly status: "saved" }
  | { readonly status: "dirty" }
  | { readonly status: "saving"; readonly sent: string }
  /** The file changed since it was read; nothing saves until Reload or Overwrite. */
  | { readonly status: "conflict" }
  | { readonly message: string; readonly status: "error" };

export type OpenFile =
  | { readonly kind: "loading"; readonly path: string }
  | { readonly kind: "error"; readonly message: string; readonly path: string }
  | { readonly kind: "binary"; readonly path: string; readonly size: number }
  | {
      /** What the file holds on the server, as far as we know. */
      readonly base: string;
      /** The editor's text. */
      readonly draft: string;
      readonly etag: SandboxFileEtag;
      readonly kind: "text";
      /**
       * Bumped each time the file is (re)loaded, so the editor starts again
       * from `opened`; typing and saving never bump it.
       */
      readonly loadCount: number;
      /** The text as last loaded: what the editor started from. */
      readonly opened: string;
      readonly path: string;
      /** Over `MAX_EDITABLE_BYTES`: shown, never saved. */
      readonly readOnly: boolean;
      readonly save: SaveState;
    };

export type OpenFileEvent =
  | { readonly path: string; readonly type: "load" }
  | { readonly message: string; readonly path: string; readonly type: "failed" }
  | {
      readonly path: string;
      readonly read: WorkspaceFileRead;
      readonly type: "loaded";
    }
  | { readonly text: string; readonly type: "edited" }
  | { readonly sent: string; readonly type: "saving" }
  | { readonly etag: SandboxFileEtag; readonly type: "saved" }
  | { readonly type: "conflict" }
  | { readonly message: string; readonly type: "save-failed" };

const settle = (draft: string, base: string): SaveState =>
  draft === base ? { status: "saved" } : { status: "dirty" };

/** Unsaved edits, including a save that hasn't answered or was refused. */
export const hasUnsavedEdits = (file: OpenFile | null): boolean =>
  file?.kind === "text" && file.draft !== file.base;

type TextFile = Extract<OpenFile, { kind: "text" }>;

const onLoaded = (
  state: OpenFile | null,
  path: string,
  read: WorkspaceFileRead
): OpenFile | null => {
  if (state?.path !== path) {
    return state;
  }
  if (read.encoding === "base64") {
    return { kind: "binary", path, size: read.size };
  }
  // Nothing changed since we read it: keep the editor (and any edits) as is.
  if (state.kind === "text" && state.etag === read.etag) {
    return state;
  }
  return {
    base: read.content,
    draft: read.content,
    etag: read.etag,
    kind: "text",
    loadCount: state.kind === "text" ? state.loadCount + 1 : 0,
    opened: read.content,
    path,
    readOnly: read.size > MAX_EDITABLE_BYTES,
    save: { status: "saved" },
  };
};

const onEdited = (state: TextFile, text: string): TextFile => {
  if (state.readOnly) {
    return state;
  }
  const { save } = state;
  return {
    ...state,
    draft: text,
    // A save in flight or a conflict keeps its state; the rest follow the text.
    save:
      save.status === "saving" || save.status === "conflict"
        ? save
        : settle(text, state.base),
  };
};

const onSaved = (state: TextFile, etag: SandboxFileEtag): TextFile => {
  if (state.save.status !== "saving") {
    return state;
  }
  const base = state.save.sent;
  return { ...state, base, etag, save: settle(state.draft, base) };
};

/** A change to a text file's save state; anything else passes through. */
const withText = (
  state: OpenFile | null,
  change: (file: TextFile) => TextFile
): OpenFile | null => (state?.kind === "text" ? change(state) : state);

export const openFileReducer = (
  state: OpenFile | null,
  event: OpenFileEvent
): OpenFile | null => {
  switch (event.type) {
    case "load":
      // A reload of the open file keeps showing it until the answer lands.
      return state?.path === event.path && state.kind === "text"
        ? state
        : { kind: "loading", path: event.path };
    case "failed":
      return state?.path === event.path
        ? { kind: "error", message: event.message, path: event.path }
        : state;
    case "loaded":
      return onLoaded(state, event.path, event.read);
    case "edited":
      return withText(state, (file) => onEdited(file, event.text));
    case "saving":
      return withText(state, (file) => ({
        ...file,
        save: { sent: event.sent, status: "saving" },
      }));
    case "saved":
      return withText(state, (file) => onSaved(file, event.etag));
    case "conflict":
      return withText(state, (file) => ({
        ...file,
        save: { status: "conflict" },
      }));
    case "save-failed":
      return withText(state, (file) => ({
        ...file,
        save: { message: event.message, status: "error" },
      }));
    default:
      return event satisfies never;
  }
};

/** Whether the idle timer (or ⌘S) should save now. */
export const shouldSave = (file: OpenFile | null): boolean =>
  file?.kind === "text" &&
  !file.readOnly &&
  file.draft !== file.base &&
  (file.save.status === "dirty" || file.save.status === "error");

export type FileNameProblem = "empty" | "directory" | "outside";

const SEGMENT_SEPARATOR = /\/+/;
const LEADING_SLASHES = /^\/+/;

/**
 * A new file's name as typed, as a workspace path: `notes.md`,
 * `src/app.ts`. No way out of the workspace, and not a directory.
 */
export const parseNewFileName = (
  input: string
): Result<string, FileNameProblem> => {
  const trimmed = input.trim().replace(LEADING_SLASHES, "");
  if (!trimmed) {
    return err("empty");
  }
  if (trimmed.endsWith("/")) {
    return err("directory");
  }
  const segments = trimmed.split(SEGMENT_SEPARATOR);
  if (segments.some((segment) => segment === ".." || segment === ".")) {
    return err("outside");
  }
  return ok(segments.join("/"));
};
