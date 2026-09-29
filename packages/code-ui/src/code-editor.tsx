"use client";

import type { SupportedLanguages } from "@pierre/diffs";
import {
  Editor,
  type EditorChangeEvent,
  type EditorFactory,
} from "@pierre/diffs/edit";
import { EditProvider, File } from "@pierre/diffs/react";
import { cn } from "@workspace/ui/lib/utils";
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { CodeHeader } from "./code-header";
import { codeThemeNames } from "./theme/code-theme";
import { diffsHostStyle } from "./theme/host-styles";
import { registerCodeThemes } from "./theme/register";
import { useCodeThemeType } from "./theme/use-code-theme-type";

registerCodeThemes();

// An editable file on @pierre/diffs' own editor (`File` with `edit`), so the
// editor and the read-only views share one highlighter, theme and look: no
// CodeMirror or Monaco. It reports text as it changes and a save request on
// ⌘S / Ctrl+S; when and how to save is the caller's business.

// The provider's factory: each surface owns its editor (the diffs skill's
// "edit with React" recipe forwards all three arguments).
const createEditor: EditorFactory<undefined, undefined> = (
  editorType,
  options,
  editStateKey
) => new Editor(editorType, options, editStateKey);

// Every session ends accepted: the caller already has the text from
// `onChange`, and rejecting would flash the original back in on unmount.
const accept = () => "accept" as const;

export interface CodeEditorProps {
  readonly className?: string;
  /**
   * The text the editor starts from. A new value (a reload) replaces
   * whatever is in the editor, undo history included; while typing, keep
   * passing the text it was opened with.
   */
  readonly contents: string;
  readonly header?: boolean;
  /** Header actions; pass `header={false}` to drop the header entirely. */
  readonly headerActions?: ReactNode;
  /** Overrides the language inferred from `path`. */
  readonly language?: SupportedLanguages;
  /** The editor's text after every change. */
  readonly onChange?: (text: string) => void;
  /** ⌘S / Ctrl+S inside the editor; the browser's save dialog is suppressed. */
  readonly onSave?: () => void;
  readonly path: string;
  /** Shows the file without an editing session (binary or oversized files). */
  readonly readOnly?: boolean;
}

const SAVE_KEY = "s";

/** A file you can edit, with Shiki highlighting and the editor's undo stack. */
export function CodeEditor({
  className,
  contents,
  header = true,
  headerActions,
  language,
  onChange,
  onSave,
  path,
  readOnly = false,
}: CodeEditorProps) {
  const { themeType } = useCodeThemeType();
  // A new `contents` mounts a fresh surface: @pierre keeps the live document
  // inside the editing session, so a changed `file` alone wouldn't reach it.
  const [loaded, setLoaded] = useState({ contents, generation: 0 });
  if (loaded.contents !== contents) {
    setLoaded({ contents, generation: loaded.generation + 1 });
  }
  const file = useMemo(
    () => ({ contents: loaded.contents, lang: language, name: path }),
    [language, loaded.contents, path]
  );
  const options = useMemo(
    () => ({
      disableFileHeader: true,
      overflow: "scroll" as const,
      theme: codeThemeNames,
      themeType,
    }),
    [themeType]
  );

  // The latest handler, without re-creating the editing session.
  const changed = useRef(onChange);
  useEffect(() => {
    changed.current = onChange;
  });
  const onEditChange = useCallback(
    (event: EditorChangeEvent<"file", undefined, undefined>) =>
      changed.current?.(event.file.contents),
    []
  );

  // Capture, so the editor's own key handling can't swallow it first.
  const onKeyDownCapture = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (
        onSave &&
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        event.key.toLowerCase() === SAVE_KEY
      ) {
        event.preventDefault();
        onSave();
      }
    },
    [onSave]
  );

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border bg-background",
        className
      )}
      data-read-only={readOnly || undefined}
      data-slot="code-editor"
      onKeyDownCapture={onKeyDownCapture}
    >
      {header ? <CodeHeader actions={headerActions} path={path} /> : null}
      <EditProvider createEditor={createEditor}>
        <File
          edit={!readOnly}
          file={file}
          key={`${path}#${loaded.generation}`}
          onEditChange={onEditChange}
          onEditComplete={accept}
          options={options}
          style={diffsHostStyle}
        />
      </EditProvider>
    </div>
  );
}
