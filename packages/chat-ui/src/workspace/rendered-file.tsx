"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { CodeHeader } from "@workspace/code-ui/code-header";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@workspace/ui/components/toggle-group";
import { type ReactNode, useCallback, useReducer } from "react";

import { Markdown } from "../conversation/markdown";
import { FileView, type FileViewProps } from "./file-view";
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

// A file that renders (066): an `.html` file shows in the built-in browser
// at its own path, a Markdown file as prose with the app's message
// renderer. Either has a Code toggle to the editor, which is the same one
// every other file opens in.

export interface RenderedFileProps extends FileViewProps {
  readonly kind: "html" | "markdown";
  readonly mode: FileMode;
  readonly onModeChange: (mode: FileMode) => void;
  readonly probe?: (url: string) => Promise<boolean>;
  readonly readFile: ReadStaticFile | null;
  readonly refreshKey: number | string;
  readonly sources: PreviewSources;
}

function ModeToggle({
  mode,
  onModeChange,
}: {
  readonly mode: FileMode;
  readonly onModeChange: (mode: FileMode) => void;
}) {
  const { t } = useLingui();
  const change = useCallback(
    (value: unknown[]) => {
      // A segmented control: pressing the shown mode keeps it.
      const [next] = value;
      if (next === "rendered" || next === "code") {
        onModeChange(next);
      }
    },
    [onModeChange]
  );
  return (
    <ToggleGroup
      aria-label={t`Show as`}
      className="shrink-0"
      onValueChange={change}
      size="sm"
      spacing={0}
      value={[mode]}
      variant="outline"
    >
      <ToggleGroupItem className="text-xs" value="rendered">
        <Trans>Preview</Trans>
      </ToggleGroupItem>
      <ToggleGroupItem className="text-xs" value="code">
        <Trans>Code</Trans>
      </ToggleGroupItem>
    </ToggleGroup>
  );
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
  readonly toggle: ReactNode;
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
      onNavigate={dispatch}
      probe={probe}
      readFile={readFile}
      refreshKey={refreshKey}
      sources={sources}
      toolbarEnd={toggle}
    />
  );
}

export function RenderedFile({
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
  if (mode === "code" || file.kind === "binary" || file.kind === "error") {
    return (
      <FileView
        {...fileView}
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
        toggle={toggle}
      />
    );
  }
  if (file.kind === "loading") {
    return <FileView {...fileView} />;
  }
  return (
    <div className="flex h-full min-h-0 flex-col p-2">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-background">
        <CodeHeader actions={toggle} path={file.path} />
        <article className="min-h-0 flex-1 overflow-auto px-6 py-5 text-sm leading-relaxed">
          <Markdown>{file.draft}</Markdown>
        </article>
      </div>
    </div>
  );
}
