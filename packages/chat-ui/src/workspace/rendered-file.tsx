"use client";

import { useCallback } from "react";

import { Markdown } from "../conversation/markdown";
import { FileView, type FileViewProps } from "./file-view";
import { ModeToggle } from "./mode-toggle";
import type { FileMode } from "./model/browser";
import { PathTitle, ViewHeader } from "./view-header";

// A Markdown file renders (066) as prose with the app's message renderer,
// with a Preview/Code toggle to the editor, which is the same one every other
// file opens in. The toggle sits in the view's one header row (070); it's
// two quiet segments, icons only when the row is short. An `.html` file
// renders in the browser half above the files instead (097), so its code is
// what the files half shows.

export interface RenderedFileProps extends FileViewProps {
  readonly mode: FileMode;
  readonly onModeChange: (mode: FileMode) => void;
}

export function RenderedFile({
  autoFocus,
  mode,
  onModeChange,
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
  if (mode === "code" || file.kind === "binary" || file.kind === "error") {
    return (
      <FileView
        {...fileView}
        autoFocus={autoFocus}
        modeToggle={file.kind === "text" ? toggle : undefined}
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
