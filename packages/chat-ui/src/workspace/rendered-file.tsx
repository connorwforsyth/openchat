"use client";

import { useCallback, useReducer } from "react";

import { Markdown } from "../conversation/markdown";
import { FileView, type FileViewProps } from "./file-view";
import { ModeToggle, type ModeToggleProps } from "./mode-toggle";
import {
  type BrowserAction,
  type BrowserHistory,
  browserHistory,
  type FileMode,
  type PreviewSources,
  pagePathOf,
} from "./model/browser";
import type { ReadStaticFile } from "./model/static-page";
import { BrowserView } from "./preview";
import { PathTitle, ViewHeader } from "./view-header";

// A file that renders (066): an `.html` file shows in the built-in browser
// at its own path, a Markdown file as prose with the app's message
// renderer. Either has a Preview/Code toggle to the editor, which is the same
// one every other file opens in. The toggle sits in the view's one header row
// (070); it's two quiet segments, icons only when the row is short.

export interface RenderedFileProps extends FileViewProps {
  readonly kind: "html" | "markdown";
  readonly mode: FileMode;
  readonly onModeChange: (mode: FileMode) => void;
  readonly probe?: (url: string) => Promise<boolean>;
  readonly readFile: ReadStaticFile | null;
  readonly refreshKey: number | string;
  readonly sources: PreviewSources;
}

const startAt = (path: string): BrowserHistory => ({
  entries: [{ path: pagePathOf(path), port: null }],
  index: 0,
  loads: 0,
});

/** The file's own browser: it starts at the file and keeps its own history. */
function HtmlFile({
  path,
  probe,
  readFile,
  refreshKey,
  sources,
  toggle,
}: {
  readonly path: string;
  readonly probe?: (url: string) => Promise<boolean>;
  readonly readFile: ReadStaticFile | null;
  readonly refreshKey: number | string;
  readonly sources: PreviewSources;
  readonly toggle: ModeToggleProps;
}) {
  const [history, dispatch] = useReducer(
    (state: BrowserHistory, action: BrowserAction) =>
      browserHistory(state, action) ?? state,
    path,
    startAt
  );
  return (
    <BrowserView
      history={history}
      modeToggle={toggle}
      onNavigate={dispatch}
      probe={probe}
      readFile={readFile}
      refreshKey={refreshKey}
      sources={sources}
    />
  );
}

export function RenderedFile({
  autoFocus,
  kind,
  mode,
  onModeChange,
  probe,
  readFile,
  refreshKey,
  sources,
  ...fileView
}: RenderedFileProps) {
  const { file, onSave } = fileView;
  // Edits not saved yet would be missing from the page: save them first.
  const changeMode = useCallback(
    (next: FileMode) => {
      if (next === "rendered") {
        onSave();
      }
      onModeChange(next);
    },
    [onModeChange, onSave]
  );
  const toggle = <ModeToggle mode={mode} onModeChange={changeMode} />;
  const toggleProps = { mode, onModeChange: changeMode };
  if (mode === "code" || file.kind === "binary" || file.kind === "error") {
    return (
      <FileView
        {...fileView}
        autoFocus={autoFocus}
        modeToggle={file.kind === "text" ? toggle : undefined}
      />
    );
  }
  if (kind === "html") {
    return (
      <HtmlFile
        key={file.path}
        path={file.path}
        probe={probe}
        readFile={readFile}
        // A save changes the version: the page reads the file again.
        refreshKey={
          file.kind === "text" ? `${refreshKey}:${file.etag}` : refreshKey
        }
        sources={sources}
        toggle={toggleProps}
      />
    );
  }
  if (file.kind === "loading") {
    return <FileView {...fileView} />;
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ViewHeader actions={toggle}>
        <PathTitle path={file.path} />
      </ViewHeader>
      <article className="min-h-0 flex-1 overflow-auto px-6 py-5 text-sm leading-relaxed">
        <Markdown>{file.draft}</Markdown>
      </article>
    </div>
  );
}
