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
import { prepareEditorColors } from "./theme/editor-colors";
import { diffsHostStyle } from "./theme/host-styles";
import { registerCodeThemes } from "./theme/register";
import { useCodeThemeType } from "./theme/use-code-theme-type";

registerCodeThemes();
// Before any editor mounts: without it, text the editor tokenizes (typing, a
// colour-scheme switch) is drawn in placeholder colours and vanishes (064).
prepareEditorColors();

// An editable file on @pierre/diffs' own editor (`File` with `edit`), so the
// editor and the read-only views share one highlighter, theme and look: no
// CodeMirror or Monaco. It reports text as it changes and a save request on
// ⌘S / Ctrl+S; when and how to save is the caller's business.

// Every session ends accepted: the caller already has the text from
// `onChange`, and rejecting would flash the original back in on unmount.
const accept = () => "accept" as const;

export interface CodeEditorProps {
  /**
   * Focus the editor once it's ready (a file opened from the Workspace's
   * search with Enter). `onAutoFocus` reports it happened, so the host can
   * stop asking before a reload remounts the editor.
   */
  readonly autoFocus?: boolean;
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
  readonly onAutoFocus?: () => void;
  /** The editor's text after every change. */
  readonly onChange?: (text: string) => void;
  /** ⌘S / Ctrl+S inside the editor; the browser's save dialog is suppressed. */
  readonly onSave?: () => void;
  readonly path: string;
  /** Shows the file without an editing session (binary or oversized files). */
  readonly readOnly?: boolean;
}

const SAVE_KEY = "s";

/** How long (in frames) autoFocus waits for the editable text. */
const FOCUS_FRAMES = 60;

/**
 * A file you can edit, with Shiki highlighting and the editor's undo stack.
 * It has no frame of its own: the host decides the surface around it (070).
 */
export function CodeEditor({
  autoFocus = false,
  className,
  contents,
  header = true,
  headerActions,
  language,
  onAutoFocus,
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

  // The latest handlers, without re-creating the editing session.
  const changed = useRef(onChange);
  const autoFocused = useRef(onAutoFocus);
  useEffect(() => {
    changed.current = onChange;
    autoFocused.current = onAutoFocus;
  });

  // The editor @pierre makes through this factory (the diffs skill's "edit
  // with React" recipe forwards all three arguments), kept for focusing it.
  // Its options pass through untouched: giving it an `onAttach` of our own
  // made it drop the first keys typed after it attached.
  const instance = useRef<Editor<"file"> | null>(null);
  const [createEditor] = useState(
    (): EditorFactory<undefined, undefined> =>
      (editorType, editorOptions, editStateKey) => {
        const editor = new Editor(editorType, editorOptions, editStateKey);
        instance.current = editor as Editor<"file">;
        return editor;
      }
  );
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!autoFocus) {
      return;
    }
    if (readOnly) {
      root.current?.focus({ preventScroll: true });
      autoFocused.current?.();
      return;
    }
    // The editable text appears a few frames after mount. Focus it at the
    // first line, so there's a caret to type at (focus alone leaves none),
    // and stop once it has focus.
    let frames = 0;
    let handle = 0;
    const step = () => {
      const host = root.current?.querySelector("diffs-container");
      const content = host?.shadowRoot?.querySelector(
        '[contenteditable="true"]'
      );
      if (content && host?.shadowRoot?.activeElement === content) {
        autoFocused.current?.();
        return;
      }
      if (content) {
        instance.current?.focus({ lineNumber: 1, preventScroll: true });
      }
      frames += 1;
      if (frames < FOCUS_FRAMES) {
        handle = requestAnimationFrame(step);
      }
    };
    step();
    return () => cancelAnimationFrame(handle);
  }, [autoFocus, readOnly]);
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
      className={cn("overflow-hidden bg-background outline-none", className)}
      data-read-only={readOnly || undefined}
      data-slot="code-editor"
      onKeyDownCapture={onKeyDownCapture}
      ref={root}
      tabIndex={readOnly ? -1 : undefined}
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
          style={diffsHostStyle(themeType)}
        />
      </EditProvider>
    </div>
  );
}
