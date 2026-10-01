"use client";

import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { FileTree, type FileTreeHandle } from "@workspace/code-ui/file-tree";
import type {
  Artifact,
  ArtifactVersion,
} from "@workspace/contract/schemas/files";
import {
  EllipsisIcon,
  FileIcon,
  FileTextIcon,
  GlobeIcon,
  PlusIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SearchIcon,
  TriangleAlertIcon,
  UploadIcon,
} from "@workspace/icons";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog";
import { Button } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { Kbd } from "@workspace/ui/components/kbd";
import { cn } from "@workspace/ui/lib/utils";
import {
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  type ArtifactSelection,
  ArtifactView,
} from "../artifacts/artifact-view";
import type { PlanEditing } from "../artifacts/plan-editor";
import type { WorkspaceSelection } from "../model/workspace";
import { usePanelFrame } from "../shell/right-panel";
import { isTypingEvent } from "../shortcuts/registry";
import { FileView } from "./file-view";
import { ModeToggle } from "./mode-toggle";
import {
  type BrowserAction,
  type FileMode,
  isHtmlPath,
  openingMode,
  type PreviewRequest,
  type PreviewSources,
  pagePathOf,
  renderedKind,
} from "./model/browser";
import type { WorkspaceFilesSource } from "./model/client";
import {
  committedMatch,
  type FileMatch,
  type MiddleText,
  resultLabel,
  searchFiles,
  searchTerms,
  stepMatch,
  type TextRun,
} from "./model/file-search";
import {
  type Maximised,
  maximisedAfter,
  type PaneLayout,
  paneLayout,
  SPLIT_DEFAULT,
  type TurnView,
  viewOf,
} from "./model/split";
import { NewFileDialog } from "./new-file-dialog";
import { BrowserView } from "./preview";
import { RenderedFile } from "./rendered-file";
import { SplitHandle } from "./split-handle";
import { useElementHeight, useElementWidth } from "./use-element-width";
import { usePreviewHistory } from "./use-preview-history";
import { useSplit } from "./use-split";
import {
  type FilesView,
  staticFiles,
  useWorkspaceFiles,
} from "./use-workspace-files";
import {
  BackToListProvider,
  headerRow,
  type RowEnd,
  RowEndActions,
  RowEndProvider,
  ViewHeader,
} from "./view-header";

// The chat's Workspace panel (060, D7): one list beside one main area. The
// list has the Preview (a built-in browser, 066, whenever there's a server
// or an HTML page to show), the Files tree and the Artifacts; the main area
// shows whichever is selected. Files open in an editor that saves as you go;
// HTML and Markdown files open rendered, with a Code toggle. There's no
// terminal and no port box: the agent runs commands and starts previews;
// people prompt, drop and edit. Load it through `LazyWorkspacePanel` (D27).
//
// 070 flattened it, after Connor's Zettelkasten: the surface is flush, each
// column has one header row (the list's is the file search; the main area's
// is the view's title and actions, then Close), and nothing inside is a card.
// "/" searches the files by name; the results replace the tree. On a narrow
// panel the list and the main area take turns, with a way back to the list.
//
// 097 split it, as Connor asked: the browser on top, the files (the list and
// the open file) below, with a divider between them that remembers where it
// was left (`model/split.ts` has the rules). The browser isn't there until
// there's something to show, and opens by itself when there is. Either half
// can be maximised. An HTML file shows in the browser and its code below.
// On a panel too narrow to stack them, the halves take turns, as the list
// and the file do: the list's Preview leads to the browser, and the browser
// leads back to the list.

/** Results shown at once; more would only be scrolled past. */
const MAX_MATCHES = 200;

/** Frames to wait for a lazily drawn target (the tree's rows) to take focus. */
const FOCUS_FRAMES = 30;

export interface WorkspaceArtifacts {
  readonly artifacts: readonly Artifact[];
  /** A plan being edited (106), shown as its editor when it's selected. */
  readonly editing?: PlanEditing | null;
  /** A message the host can show if loading versions failed. */
  readonly error?: string | null;
  /** The artifact runtime's origin (`ARTIFACTS_ORIGIN`, D24). */
  readonly runtimeOrigin?: string | null;
  /** Versions of the shown artifact, oldest first; `undefined` while loading. */
  readonly versions: readonly ArtifactVersion[] | undefined;
}

export interface WorkspacePanelProps {
  readonly artifacts: WorkspaceArtifacts;
  readonly className?: string;
  readonly files: WorkspaceFilesSource;
  readonly onSelect: (selection: WorkspaceSelection | null) => void;
  /** A page the chat asks the Preview to show (`openPreview`, an `.html` write). */
  readonly previewRequest?: PreviewRequest | null;
  /** Checks a preview answers before showing it; for tests. */
  readonly probePreview?: (url: string) => Promise<boolean>;
  /** `workspaceRevision` of the chat's messages. */
  readonly revision: number;
  /** What the main area shows. */
  readonly selection: WorkspaceSelection | null;
}

export function WorkspacePanel(props: WorkspacePanelProps) {
  const { files } = props;
  const filesSelection = useFilesSelection(props.selection);
  return files.kind === "chat" ? (
    <ChatWorkspacePanel
      {...props}
      files={files}
      filesSelection={filesSelection}
    />
  ) : (
    <WorkspaceLayout
      {...props}
      filesSelection={filesSelection}
      view={staticFiles(files.kind)}
    />
  );
}

/**
 * What the files half shows. The Preview is in the other half now, so
 * picking it (or the chat opening it) leaves the open file where it was.
 */
function useFilesSelection(
  selection: WorkspaceSelection | null
): WorkspaceSelection | null {
  const own = selection?.kind === "preview" ? null : selection;
  const [held, setHeld] = useState(own);
  if (
    selection?.kind !== "preview" &&
    selectionKey(held) !== selectionKey(own)
  ) {
    setHeld(own);
  }
  return selection?.kind === "preview" ? held : own;
}

interface LayoutProps extends WorkspacePanelProps {
  /** The files half's selection: `selection`, or what it was before the Preview. */
  readonly filesSelection: WorkspaceSelection | null;
}

function ChatWorkspacePanel(
  props: LayoutProps & {
    readonly files: Extract<WorkspaceFilesSource, { kind: "chat" }>;
  }
) {
  const { files, filesSelection, onSelect, revision } = props;
  const onSelectFile = useCallback(
    (path: string | null) => onSelect(path ? { kind: "file", path } : null),
    [onSelect]
  );
  const view = useWorkspaceFiles({
    files,
    onSelectFile,
    revision,
    selectedPath: selectionPath(filesSelection),
  });
  return <WorkspaceLayout {...props} view={view} />;
}

const hasFiles = (event: DragEvent) =>
  event.dataTransfer.types.includes("Files");

/** One key per thing the main area can show, to tell selections apart. */
const selectionKey = (selection: WorkspaceSelection | null): string | null => {
  switch (selection?.kind) {
    case undefined:
      return null;
    case "file":
      return `file:${selection.path}`;
    case "artifact":
      return `artifact:${selection.artifactId ?? ""}`;
    case "preview":
      return "preview";
    default:
      return selection satisfies never;
  }
};

interface Turn {
  readonly key: string | null;
  readonly maximised: Maximised;
  readonly previewing: string | null;
  /** The chat's last request for a page (`previewRequest.id`). */
  readonly request: number | null;
  readonly view: TurnView;
}

/**
 * Which half (and, narrow, which column) shows, and which half is
 * maximised. A new selection shows what it asks for (`viewOf`), except one
 * the file search is only previewing (↓/↑), which keeps the list in view;
 * Back to the list shows the list. A page the chat asks for shows the
 * browser. A pick also restores a maximised half that would hide it.
 */
function usePanes(
  selection: WorkspaceSelection | null,
  request: number | null,
  asked: TurnView
) {
  const key = selectionKey(selection);
  const [turn, setTurn] = useState<Turn>(() => ({
    key,
    maximised: null,
    previewing: null,
    request,
    view: asked,
  }));
  if (turn.key !== key || turn.request !== request) {
    const requested = turn.request !== request && request !== null;
    setTurn({
      key,
      maximised: maximisedAfter(
        turn.maximised,
        requested ? { kind: "preview" } : selection
      ),
      previewing: turn.previewing,
      request,
      view: nextView(key, asked, requested, turn),
    });
  }
  const showList = useCallback(
    () => setTurn((current) => ({ ...current, view: "list" })),
    []
  );
  const show = useCallback(
    (next: TurnView) =>
      setTurn((current) => ({ ...current, previewing: null, view: next })),
    []
  );
  const previewing = useCallback(
    (path: string) =>
      setTurn((current) => ({ ...current, previewing: `file:${path}` })),
    []
  );
  const maximise = useCallback(
    (half: "browser" | "files") =>
      setTurn((current) => ({
        ...current,
        maximised: current.maximised === half ? null : half,
      })),
    []
  );
  const { maximised, view } = turn;
  return useMemo(
    () => ({ maximise, maximised, previewing, show, showList, view }),
    [maximise, maximised, previewing, show, showList, view]
  );
}

const nextView = (
  key: string | null,
  asked: TurnView,
  requested: boolean,
  turn: Turn
): TurnView => {
  if (requested) {
    return "browser";
  }
  if (key === null) {
    return "list";
  }
  return key === turn.previewing ? turn.view : asked;
};

/**
 * Calls `attempt` each frame until it succeeds (the tree draws its rows after
 * it mounts), for a while at most. Returns a cancel.
 */
const whenReady = (attempt: () => boolean): (() => void) => {
  let frame = 0;
  let handle = 0;
  const step = () => {
    if (!attempt() && frame < FOCUS_FRAMES) {
      frame += 1;
      handle = requestAnimationFrame(step);
    }
  };
  step();
  return () => cancelAnimationFrame(handle);
};

function useFileDrop(
  writable: boolean,
  importFiles: ((files: readonly File[]) => void) | undefined
) {
  const [dragging, setDragging] = useState(false);
  // Dropping files anywhere on the panel adds them to the workspace.
  const onDragOver = useCallback(
    (event: DragEvent<HTMLElement>) => {
      if (writable && hasFiles(event)) {
        event.preventDefault();
        setDragging(true);
      }
    },
    [writable]
  );
  const onDragLeave = useCallback((event: DragEvent<HTMLElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setDragging(false);
    }
  }, []);
  const onDrop = useCallback(
    (event: DragEvent<HTMLElement>) => {
      setDragging(false);
      if (writable && importFiles && hasFiles(event)) {
        event.preventDefault();
        importFiles([...event.dataTransfer.files]);
      }
    },
    [importFiles, writable]
  );
  return { dragging, onDragLeave, onDragOver, onDrop };
}

/** The search field's state and keys (`model/file-search.ts` is the logic). */
function useFileSearch({
  onClear,
  onOpen,
  onPreview,
  paths,
}: {
  readonly onClear: () => void;
  readonly onOpen: (match: FileMatch) => void;
  readonly onPreview: (match: FileMatch) => void;
  readonly paths: readonly string[] | null;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);
  const searching = searchTerms(query).length > 0;
  const matches = useMemo(
    () => searchFiles(paths ?? [], query).slice(0, MAX_MATCHES),
    [paths, query]
  );
  const changeQuery = useCallback((next: string) => {
    setQuery(next);
    setActive(-1);
  }, []);
  const onChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => changeQuery(event.target.value),
    [changeQuery]
  );
  const step = useCallback(
    (delta: 1 | -1) => {
      const next = stepMatch(active, matches.length, delta);
      const match = matches[next];
      if (match) {
        setActive(next);
        onPreview(match);
      }
    },
    [active, matches, onPreview]
  );
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.nativeEvent.isComposing) {
        return;
      }
      switch (event.key) {
        case "ArrowDown":
        case "ArrowUp":
          event.preventDefault();
          step(event.key === "ArrowDown" ? 1 : -1);
          return;
        case "Enter": {
          event.preventDefault();
          const match = committedMatch(matches, active);
          if (match) {
            onOpen(match);
          }
          return;
        }
        case "Escape":
          // The panel's own Escape (close) waits for the next one.
          event.preventDefault();
          changeQuery("");
          onClear();
          return;
        default:
          return;
      }
    },
    [active, changeQuery, matches, onClear, onOpen, step]
  );
  return {
    active,
    matches,
    onChange,
    onKeyDown,
    open: onOpen,
    query,
    searching,
  };
}

type FocusRequest =
  | { readonly kind: "search" }
  | { readonly kind: "tree" }
  /** Enter in the search: the editor (or a rendered file's view) once it's open. */
  | { readonly kind: "view"; readonly path: string };

/**
 * Where focus goes next, once what it goes to is on screen; and opening the
 * panel moves focus from its frame into the tree once there is one.
 */
function usePanelFocus(listed: boolean) {
  // Where focus goes next, once what it goes to is on screen.
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const tree = useRef<FileTreeHandle>(null);
  useEffect(() => {
    if (focusRequest?.kind === "search") {
      searchInput.current?.focus();
      searchInput.current?.select();
      setFocusRequest(null);
    } else if (focusRequest?.kind === "tree") {
      setFocusRequest(null);
      return whenReady(() => tree.current?.focus() ?? false);
    }
  }, [focusRequest]);

  // Opening the panel put focus on its frame (`RightPanel`); move it on to
  // the tree, once there is one, unless it went somewhere else meanwhile.
  const panel = usePanelFrame();
  useEffect(() => {
    const frame = panel?.frame.current;
    if (!(frame && listed) || frame.ownerDocument.activeElement !== frame) {
      return;
    }
    return whenReady(
      () =>
        frame.ownerDocument.activeElement !== frame ||
        (tree.current?.focus() ?? false)
    );
  }, [listed, panel]);

  return { focusRequest, searchInput, setFocusRequest, tree };
}

/**
 * Rendered or Code, per file, for as long as the panel is open. A file that
 * opens empty (a new one) opens as code: there's nothing to render.
 */
function useModes(open: FilesView["open"]) {
  const [modes, setModes] = useState<Readonly<Record<string, FileMode>>>({});
  if (
    open?.kind === "text" &&
    open.opened === "" &&
    modes[open.path] === undefined &&
    renderedKind(open.path) !== null
  ) {
    setModes({ ...modes, [open.path]: "code" });
  }
  const setMode = useCallback(
    (path: string, mode: FileMode) =>
      setModes((current) => ({ ...current, [path]: mode })),
    []
  );
  return { modes, setMode };
}

/**
 * An HTML file opens in the browser, at its own path, and its code below:
 * the browser goes there when the file is picked, and reads it again when
 * a save changes its version.
 */
function useHtmlPage(
  filesSelection: WorkspaceSelection | null,
  navigate: (action: BrowserAction) => void,
  open: FilesView["open"]
) {
  const htmlPath =
    filesSelection?.kind === "file" && isHtmlPath(filesSelection.path)
      ? filesSelection.path
      : null;
  const showFile = useCallback(
    (path: string) =>
      navigate({
        page: { path: pagePathOf(path), port: null },
        type: "navigate",
      }),
    [navigate]
  );
  // Once per pick: going elsewhere in the browser afterwards is the person's.
  const shownFor = useRef<string | null>(null);
  useEffect(() => {
    if (htmlPath !== shownFor.current) {
      shownFor.current = htmlPath;
      if (htmlPath) {
        showFile(htmlPath);
      }
    }
  }, [htmlPath, showFile]);
  const htmlVersion =
    open?.kind === "text" && open.path === htmlPath ? open.etag : "";
  return { htmlPath, htmlVersion, showFile };
}

/**
 * Taking turns, an HTML file's page and its code are a Preview/Code switch
 * apart, as before the split; `null` when there's no such switch.
 */
function usePageMode({
  htmlPath,
  save,
  setMode,
  show,
  showFile,
}: {
  /** The open HTML file, when the halves take turns. */
  readonly htmlPath: string | null;
  readonly save: (() => void) | undefined;
  readonly setMode: (path: string, mode: FileMode) => void;
  readonly show: (view: TurnView) => void;
  readonly showFile: (path: string) => void;
}): ((mode: FileMode) => void) | null {
  const change = useCallback(
    (mode: FileMode) => {
      if (!htmlPath) {
        return;
      }
      setMode(htmlPath, mode);
      if (mode === "rendered") {
        // Edits not saved yet would be missing from the page.
        save?.();
        showFile(htmlPath);
      }
      show(mode === "rendered" ? "browser" : "main");
    },
    [htmlPath, save, setMode, show, showFile]
  );
  return htmlPath ? change : null;
}

/** Each half's header row ends with its Maximise; only the top one with Close. */
function useRowEnds(
  layout: PaneLayout,
  maximise: (half: "browser" | "files") => void,
  maximised: Maximised
): { readonly browser: RowEnd; readonly files: RowEnd } {
  const { t } = useLingui();
  const { browser: browserShown, maximisable } = layout;
  return useMemo(
    () => ({
      browser: {
        close: true,
        maximise: maximisable
          ? {
              label: t`Maximise the browser`,
              onToggle: () => maximise("browser"),
              pressed: maximised === "browser",
            }
          : null,
      },
      files: {
        close: !browserShown,
        maximise: maximisable
          ? {
              label: t`Maximise the files`,
              onToggle: () => maximise("files"),
              pressed: maximised === "files",
            }
          : null,
      },
    }),
    [browserShown, maximisable, maximise, maximised, t]
  );
}

/** The browser half: its share of the height, or all of it, or hidden. */
function BrowserPane({
  backToList,
  children,
  flex,
  hidden,
  id,
  rowEnd,
}: {
  readonly backToList: (() => void) | null;
  readonly children: ReactNode;
  readonly flex: string;
  readonly hidden: boolean;
  readonly id: string;
  readonly rowEnd: RowEnd;
}) {
  const { t } = useLingui();
  return (
    <RowEndProvider value={rowEnd}>
      <BackToListProvider value={backToList}>
        {/* Hidden, not unmounted, while the files have the height: the page stays loaded. */}
        <section
          aria-label={t`Browser`}
          className="@container/view flex min-h-30 min-w-0 flex-col"
          data-slot="workspace-browser"
          hidden={hidden}
          id={id}
          style={{ flex }}
        >
          {children}
        </section>
      </BackToListProvider>
    </RowEndProvider>
  );
}

/** Failures speak, at the foot of the panel so the header rows stay aligned. */
function PanelStatus({ view }: { readonly view: FilesView }) {
  const { actions, status } = view;
  return (
    <>
      {status.kind === "failed" && actions ? (
        <Alert
          className="rounded-none border-x-0 border-b-0"
          variant="destructive"
        >
          <TriangleAlertIcon aria-hidden />
          <AlertTitle>
            <Trans>The workspace didn't start</Trans>
          </AlertTitle>
          <AlertDescription>
            <p>{status.message}</p>
            <p>
              <Trans>
                It starts again the next time you or the agent use a file.
              </Trans>
            </p>
            <Button
              className="mt-1"
              onClick={actions.refresh}
              size="sm"
              variant="outline"
            >
              <Trans>Retry</Trans>
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {view.notice ? (
        <p className="border-t px-3 py-2 text-destructive text-sm" role="alert">
          {view.notice}
        </p>
      ) : null}
    </>
  );
}

/** What the browser can show: the workspace's pages and the agent's servers. */
function usePreviewSources(view: FilesView): PreviewSources {
  const { paths, previews, provider } = view;
  return useMemo(
    () => ({
      htmlPaths: (paths ?? []).filter(
        (path) => !path.endsWith("/") && isHtmlPath(path)
      ),
      previews,
      provider,
    }),
    [paths, previews, provider]
  );
}

function WorkspaceLayout({
  artifacts,
  className,
  filesSelection,
  onSelect,
  previewRequest,
  probePreview,
  revision,
  selection,
  view,
}: LayoutProps & { readonly view: FilesView }) {
  const { t } = useLingui();
  const [newFileOpen, setNewFileOpen] = useState(false);
  const { actions, status } = view;
  const writable = actions !== null && status.kind === "ready";

  const { paths } = view;
  const sources = usePreviewSources(view);
  const preview = usePreviewHistory(sources, previewRequest);

  const { open } = view;
  const { modes, setMode } = useModes(open);

  // The halves, and on a narrow panel whose turn it is.
  const [measure, width] = useElementWidth<HTMLElement>();
  const [measureHeight, height] = useElementHeight<HTMLDivElement>();
  const panes = usePanes(
    selection,
    previewRequest?.id ?? null,
    viewOf(selection, modes)
  );
  const hasPreview = preview.history !== null;
  const layout = paneLayout({
    filesSelected: filesSelection !== null,
    hasPreview,
    maximised: panes.maximised,
    view: panes.view,
    width,
  });
  const { listAlone } = layout;
  const split = useSplit();
  const browserId = useId();

  const { navigate } = preview;
  const { htmlPath, htmlVersion, showFile } = useHtmlPage(
    filesSelection,
    navigate,
    open
  );

  const { focusRequest, searchInput, setFocusRequest, tree } = usePanelFocus(
    paths !== null
  );
  const main = useRef<HTMLDivElement>(null);

  // Picking something clears a pending Enter's focus request.
  const select = useCallback(
    (next: WorkspaceSelection | null) => {
      setFocusRequest(null);
      onSelect(next);
    },
    [onSelect, setFocusRequest]
  );
  const { show } = panes;
  const activate = useCallback(
    (next: WorkspaceSelection) => {
      select(next);
      show(viewOf(next, modes));
    },
    [modes, select, show]
  );
  // The list's own way back to what's open, on a narrow panel.
  const showOpen = useCallback(
    () => show(viewOf(filesSelection, modes)),
    [filesSelection, modes, show]
  );

  // The file search: ↓/↑ show a result without leaving the search (or the
  // list, when narrow); Enter (or a click) opens it and moves focus into it;
  // Escape clears it and goes back to the tree.
  const { previewing } = panes;
  const search = useFileSearch({
    onClear: useCallback(
      () => setFocusRequest({ kind: "tree" }),
      [setFocusRequest]
    ),
    onOpen: useCallback(
      (match: FileMatch) => {
        // Into its code: an HTML file's page is already in the browser.
        select({ kind: "file", path: match.path });
        show("main");
        setFocusRequest({ kind: "view", path: match.path });
      },
      [select, show, setFocusRequest]
    ),
    onPreview: useCallback(
      (match: FileMatch) => {
        setFocusRequest(null);
        previewing(match.path);
        onSelect({ kind: "file", path: match.path });
      },
      [onSelect, previewing, setFocusRequest]
    ),
    paths,
  });

  // "/" anywhere in the panel (not while typing) goes to the search.
  const { showList } = panes;
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (
        event.key !== "/" ||
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        isTypingEvent(event.nativeEvent)
      ) {
        return;
      }
      event.preventDefault();
      showList();
      setFocusRequest({ kind: "search" });
    },
    [showList, setFocusRequest]
  );

  const openNewFile = useCallback(() => setNewFileOpen(true), []);
  const drop = useFileDrop(writable, actions?.importFiles);

  const focusView =
    focusRequest?.kind === "view" &&
    focusRequest.path === selectionPath(filesSelection)
      ? focusRequest.path
      : null;
  const viewFocused = useCallback(
    () => setFocusRequest(null),
    [setFocusRequest]
  );

  const rowEnds = useRowEnds(layout, panes.maximise, panes.maximised);

  const pageMode = usePageMode({
    htmlPath: layout.turns ? htmlPath : null,
    save: actions?.save,
    setMode,
    show,
    showFile,
  });

  return (
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: a drop target for files ("Upload files…" in the menu does the same from the keyboard), and "/" to search from anywhere in it.
    <section
      aria-label={t`Workspace`}
      className={cn(
        "relative flex h-full min-h-0 flex-col bg-background",
        className
      )}
      data-dragging={drop.dragging || undefined}
      data-narrow={listAlone || undefined}
      onDragLeave={drop.onDragLeave}
      onDragOver={drop.onDragOver}
      onDrop={drop.onDrop}
      onKeyDown={onKeyDown}
      ref={measure}
    >
      <div className="flex min-h-0 flex-1 flex-col" ref={measureHeight}>
        {hasPreview ? (
          <BrowserPane
            backToList={layout.turns ? showList : null}
            flex={layout.files ? `0 1 ${split.fraction * 100}%` : "1 1 0%"}
            hidden={!layout.browser}
            id={browserId}
            rowEnd={rowEnds.browser}
          >
            <BrowserView
              history={preview.history}
              modeToggle={
                pageMode
                  ? { mode: "rendered", onModeChange: pageMode }
                  : undefined
              }
              onNavigate={navigate}
              probe={probePreview}
              readFile={view.readFile}
              refreshKey={`${revision}:${htmlVersion}`}
              sources={sources}
            />
          </BrowserPane>
        ) : null}
        {layout.divider ? (
          <SplitHandle
            aria-controls={browserId}
            aria-label={t`Resize the browser`}
            defaultValue={SPLIT_DEFAULT}
            height={height}
            onResize={split.setLive}
            onResizeEnd={split.save}
            value={split.fraction}
          />
        ) : null}
        <RowEndProvider value={rowEnds.files}>
          <div
            className="flex min-h-30 flex-1"
            data-slot="workspace-files"
            hidden={!layout.files}
          >
            <WorkspaceList
              active={search.active}
              artifacts={artifacts.artifacts}
              className={listAlone ? "flex-1" : "w-48 shrink-0 border-e"}
              hidden={!layout.list}
              matches={search.matches}
              narrow={listAlone}
              onActivate={activate}
              onNewFile={openNewFile}
              onOpenMatch={search.open}
              onQueryChange={search.onChange}
              onSearchKeyDown={search.onKeyDown}
              onShowOpen={showOpen}
              previewCurrent={selection?.kind === "preview"}
              previewItem={hasPreview && !layout.browser}
              query={search.query}
              searchInput={searchInput}
              searching={search.searching}
              selection={filesSelection}
              tree={tree}
              view={view}
              writable={writable}
            />
            <BackToListProvider value={listAlone ? showList : null}>
              {/* Hidden, not unmounted, on its turn off: the editor keeps its state. */}
              <div
                className="@container/view flex min-h-0 min-w-0 flex-1 flex-col outline-none"
                hidden={!layout.main}
                ref={main}
                tabIndex={-1}
              >
                <MainArea
                  artifacts={artifacts}
                  focusView={focusView}
                  main={main}
                  modes={modes}
                  onModeChange={setMode}
                  onNewFile={openNewFile}
                  onPageMode={pageMode}
                  onSelect={select}
                  onViewFocused={viewFocused}
                  selection={filesSelection}
                  view={view}
                  writable={writable}
                />
              </div>
            </BackToListProvider>
          </div>
        </RowEndProvider>
      </div>
      <PanelStatus view={view} />
      {drop.dragging ? (
        <div className="pointer-events-none absolute inset-2 flex items-center justify-center rounded-lg border-2 border-ring border-dashed bg-background/80 text-sm">
          <Trans>Drop to add to the workspace</Trans>
        </div>
      ) : null}
      {actions ? (
        <NewFileDialog
          onCreate={actions.create}
          onOpenChange={setNewFileOpen}
          open={newFileOpen}
        />
      ) : null}
    </section>
  );
}

const selectionPath = (selection: WorkspaceSelection | null): string | null =>
  selection?.kind === "file" ? selection.path : null;

function ListItem({
  current,
  icon,
  label,
  onClick,
}: {
  readonly current: boolean;
  readonly icon: ReactNode;
  readonly label: string;
  readonly onClick: () => void;
}) {
  return (
    <li>
      <button
        aria-current={current ? "true" : undefined}
        className={cn(
          "flex h-7 w-full items-center gap-2 rounded-md px-2 text-start text-sm outline-none transition-colors duration-(--motion-fast) hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground",
          current && "bg-muted font-medium"
        )}
        onClick={onClick}
        type="button"
      >
        {icon}
        <span className="truncate">{label}</span>
      </button>
    </li>
  );
}

/** A section's quiet label in the list. */
function SectionLabel({ children }: { readonly children: ReactNode }) {
  return (
    <h3 className="px-2 py-1 font-medium text-muted-foreground text-xs">
      {children}
    </h3>
  );
}

function WorkspaceList({
  active,
  artifacts,
  className,
  hidden,
  matches,
  narrow,
  onActivate,
  onNewFile,
  onOpenMatch,
  onQueryChange,
  onSearchKeyDown,
  onShowOpen,
  previewCurrent,
  previewItem,
  query,
  searchInput,
  searching,
  selection,
  tree,
  view,
  writable,
}: {
  readonly active: number;
  readonly artifacts: readonly Artifact[];
  readonly className?: string;
  /** A narrow panel showing the main area. */
  readonly hidden: boolean;
  readonly matches: readonly FileMatch[];
  readonly narrow: boolean;
  readonly onActivate: (selection: WorkspaceSelection) => void;
  readonly onNewFile: () => void;
  readonly onOpenMatch: (match: FileMatch) => void;
  readonly onQueryChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly onSearchKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  /** Shows what's open again, on a narrow panel. */
  readonly onShowOpen: () => void;
  /** The Preview is what the chat last picked. */
  readonly previewCurrent: boolean;
  /** The way to the browser, when it isn't on screen (its turn, or maximised files). */
  readonly previewItem: boolean;
  readonly query: string;
  readonly searchInput: RefObject<HTMLInputElement | null>;
  readonly searching: boolean;
  readonly selection: WorkspaceSelection | null;
  readonly tree: RefObject<FileTreeHandle | null>;
  readonly view: FilesView;
  readonly writable: boolean;
}) {
  const { t } = useLingui();
  const results = useId();
  const shownArtifact =
    selection?.kind === "artifact"
      ? (selection.artifactId ?? artifacts[0]?.id)
      : undefined;

  // Directories expand in place; only files open. The tree also reports
  // the selection it was given (the open file); that's not a pick.
  const openPath = selection?.kind === "file" ? selection.path : null;
  const selectFile = useCallback(
    (selected: readonly string[]) => {
      const path = selected.at(-1);
      if (path && !path.endsWith("/") && path !== openPath) {
        onActivate({ kind: "file", path });
      }
    },
    [onActivate, openPath]
  );
  const selectPreview = useCallback(
    () => onActivate({ kind: "preview" }),
    [onActivate]
  );
  // On a narrow panel, the file that's already selected opens again from
  // the tree too (the tree reports only changes of selection).
  const onTreeActivate = useCallback(
    (event: KeyboardEvent<HTMLElement> | MouseEvent<HTMLElement>) => {
      if ("key" in event && event.key !== "Enter") {
        return;
      }
      const row = event.nativeEvent
        .composedPath()
        .find(
          (target): target is HTMLElement =>
            target instanceof HTMLElement &&
            target.dataset.itemType !== undefined
        );
      if (row?.dataset.itemType === "file") {
        onShowOpen();
      }
    },
    [onShowOpen]
  );

  const activeId = active >= 0 ? `${results}-${active}` : undefined;
  useEffect(() => {
    if (activeId) {
      document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
    }
  }, [activeId]);

  return (
    <nav
      aria-label={t`Workspace contents`}
      className={cn("flex min-h-0 flex-col", className)}
      hidden={hidden}
    >
      <div className={headerRow}>
        {/* A search field that sits in the row: no frame, a ring on focus. */}
        <div className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md ps-1.5 pe-1 focus-within:ring-2 focus-within:ring-ring/50">
          <SearchIcon
            aria-hidden
            className="size-4 shrink-0 text-muted-foreground"
          />
          <input
            aria-activedescendant={activeId}
            aria-autocomplete="list"
            aria-controls={searching ? results : undefined}
            aria-expanded={searching}
            aria-label={t`Search files`}
            autoComplete="off"
            className="h-7 w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
            disabled={view.paths === null}
            onChange={onQueryChange}
            onKeyDown={onSearchKeyDown}
            placeholder={t`Search files`}
            ref={searchInput}
            role="combobox"
            spellCheck={false}
            type="search"
            value={query}
          />
          {query ? null : (
            <Kbd className="pointer-coarse:hidden" title={t`Press / to search`}>
              /
            </Kbd>
          )}
        </div>
        {narrow ? <RowEndActions /> : null}
      </div>
      {searching ? (
        <SearchResults
          active={active}
          id={results}
          matches={matches}
          onOpen={onOpenMatch}
          query={query}
        />
      ) : null}
      {/* Hidden, not unmounted, while searching: the tree keeps its folds. */}
      <div
        className="flex min-h-0 flex-1 flex-col gap-3 p-2"
        hidden={searching}
      >
        {previewItem ? (
          <ul>
            <ListItem
              current={previewCurrent}
              icon={<GlobeIcon aria-hidden />}
              label={t`Preview`}
              onClick={selectPreview}
            />
          </ul>
        ) : null}
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center gap-0.5">
            <SectionLabel>
              <Trans>Files</Trans>
            </SectionLabel>
            <Button
              aria-label={t`New file`}
              className="ms-auto"
              disabled={!writable}
              onClick={onNewFile}
              size="icon-xs"
              title={t`New file`}
              variant="ghost"
            >
              <PlusIcon aria-hidden />
            </Button>
            <WorkspaceMenu view={view} writable={writable} />
          </div>
          {/* biome-ignore lint/a11y/noStaticElementInteractions: the tree's rows are the controls; this only notices a row that was already selected being opened again. */}
          {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: as above. */}
          <div
            className="flex min-h-0 flex-1 flex-col"
            onClick={onTreeActivate}
            onKeyDown={onTreeActivate}
          >
            <FilesList
              onSelectFiles={selectFile}
              selectedPath={selection?.kind === "file" ? selection.path : null}
              tree={tree}
              view={view}
            />
          </div>
        </div>
        <div className="flex max-h-[40%] shrink-0 flex-col overflow-auto">
          <SectionLabel>
            <Trans>Artifacts</Trans>
          </SectionLabel>
          {artifacts.length === 0 ? (
            <p className="px-2 py-1 text-muted-foreground text-sm">
              <Trans>None yet</Trans>
            </p>
          ) : (
            <ul
              aria-label={t`Artifacts in this chat`}
              className="flex flex-col"
            >
              {artifacts.map((artifact) => (
                <ArtifactItem
                  artifact={artifact}
                  current={artifact.id === shownArtifact}
                  key={artifact.id}
                  onSelect={onActivate}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </nav>
  );
}

/** The search's results, in place of the tree: one row per file. */
function SearchResults({
  active,
  id,
  matches,
  onOpen,
  query,
}: {
  readonly active: number;
  readonly id: string;
  readonly matches: readonly FileMatch[];
  readonly onOpen: (match: FileMatch) => void;
  readonly query: string;
}) {
  const { t } = useLingui();
  const terms = useMemo(() => searchTerms(query), [query]);
  const count = matches.length;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p
        aria-live="polite"
        className="px-4 pt-2 pb-1 text-muted-foreground text-xs"
      >
        {count === 0 ? (
          <Trans>Nothing found</Trans>
        ) : (
          <Plural one="# found" other="# found" value={count} />
        )}
      </p>
      <div
        aria-label={t`Files found`}
        className="min-h-0 flex-1 overflow-auto px-2 pb-2"
        id={id}
        role="listbox"
      >
        {matches.map((match, index) => (
          <SearchOption
            active={index === active}
            id={`${id}-${index}`}
            key={match.path}
            match={match}
            onOpen={onOpen}
            terms={terms}
          />
        ))}
      </div>
    </div>
  );
}

// Keeps focus in the search field when a result is clicked.
const keepFocus = (event: MouseEvent) => event.preventDefault();

function SearchOption({
  active,
  id,
  match,
  onOpen,
  terms,
}: {
  readonly active: boolean;
  readonly id: string;
  readonly match: FileMatch;
  readonly onOpen: (match: FileMatch) => void;
  readonly terms: readonly string[];
}) {
  const open = useCallback(() => onOpen(match), [match, onOpen]);
  const label = useMemo(() => resultLabel(match, terms), [match, terms]);
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the search field owns the keys (↓/↑, Enter); focus stays there (aria-activedescendant).
    <div
      aria-selected={active}
      className="flex min-h-7 cursor-default flex-col justify-center rounded-md px-2 py-1 text-sm hover:bg-muted aria-selected:bg-muted"
      id={id}
      onClick={open}
      onMouseDown={keepFocus}
      role="option"
      tabIndex={-1}
      title={match.path}
    >
      {/* The name first; its folder, quieter, under it (after the Zettelkasten's title, then snippet). */}
      <MiddleTruncated text={label.name} />
      {match.directory ? (
        <MiddleTruncated
          className="text-muted-foreground text-xs"
          text={label.directory}
        />
      ) : null}
    </div>
  );
}

/**
 * One line that gives way in the middle: the head ends in an ellipsis and
 * the tail stays, unless the row is narrower than the tail alone.
 */
function MiddleTruncated({
  className,
  text,
}: {
  readonly className?: string;
  readonly text: MiddleText;
}) {
  return (
    <span className={cn("flex min-w-0", className)}>
      {/* `whitespace-pre`, not `truncate`: a space where the two meet stays. */}
      <span className="min-w-0 overflow-hidden text-ellipsis whitespace-pre">
        <Runs runs={text.head} />
      </span>
      {/* Never shrinks (any shrinking at all shows an ellipsis); only a row
          narrower than the tail itself cuts it, at its end. */}
      <span className="max-w-full shrink-0 overflow-hidden text-ellipsis whitespace-pre">
        <Runs runs={text.tail} />
      </span>
    </span>
  );
}

/** What the query matched, marked. */
function Runs({ runs }: { readonly runs: readonly TextRun[] }) {
  return runs.map((run, index) =>
    run.hit ? (
      <mark
        className="rounded-xs bg-primary/10 text-foreground"
        // biome-ignore lint/suspicious/noArrayIndexKey: runs are positional and never reorder.
        key={index}
      >
        {run.text}
      </mark>
    ) : (
      run.text
    )
  );
}

function ArtifactItem({
  artifact,
  current,
  onSelect,
}: {
  readonly artifact: Artifact;
  readonly current: boolean;
  readonly onSelect: (selection: WorkspaceSelection) => void;
}) {
  const select = useCallback(
    () => onSelect({ artifactId: artifact.id, kind: "artifact" }),
    [artifact.id, onSelect]
  );
  return (
    <ListItem
      current={current}
      icon={<FileTextIcon aria-hidden />}
      label={artifact.title}
      onClick={select}
    />
  );
}

/** The list's states read like its rows: the same size, just quieter. */
function ListNote({
  children,
  status = false,
}: {
  readonly children: ReactNode;
  readonly status?: boolean;
}) {
  return (
    <p
      className="px-2 py-1 text-muted-foreground text-sm"
      role={status ? "status" : undefined}
    >
      {children}
    </p>
  );
}

function FilesList({
  onSelectFiles,
  selectedPath,
  tree,
  view,
}: {
  readonly onSelectFiles: (paths: readonly string[]) => void;
  /** The open file; the tree follows it, so a file opened from the chat shows selected. */
  readonly selectedPath: string | null;
  readonly tree: RefObject<FileTreeHandle | null>;
  readonly view: FilesView;
}) {
  const { t } = useLingui();
  const { paths, status } = view;
  if (status.kind === "off") {
    return (
      <ListNote>
        <Trans>Files are turned off on this server.</Trans>
      </ListNote>
    );
  }
  if (status.kind === "starting") {
    return (
      <ListNote status>
        <Trans>Starting the workspace…</Trans>
      </ListNote>
    );
  }
  if (paths === null) {
    return (
      <ListNote status>
        <Trans>Loading files…</Trans>
      </ListNote>
    );
  }
  if (paths.length === 0) {
    return (
      <ListNote>
        <Trans>No files yet</Trans>
      </ListNote>
    );
  }
  return (
    <FileTree
      className="-mx-2 min-h-0 flex-1"
      label={t`Files`}
      onSelectionChange={onSelectFiles}
      paths={paths}
      ref={tree}
      search={false}
      selectedPath={selectedPath}
      variant="flush"
    />
  );
}

function WorkspaceMenu({
  view,
  writable,
}: {
  readonly view: FilesView;
  readonly writable: boolean;
}) {
  const { t } = useLingui();
  const { actions } = view;
  const [confirmReset, setConfirmReset] = useState(false);
  const upload = useRef<HTMLInputElement>(null);
  const importFiles = actions?.importFiles;

  const chooseFiles = useCallback(() => upload.current?.click(), []);
  const chosen = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      importFiles?.([...(event.target.files ?? [])]);
      event.target.value = "";
    },
    [importFiles]
  );
  const askReset = useCallback(() => setConfirmReset(true), []);
  const reset = actions?.reset;
  const doReset = useCallback(() => {
    setConfirmReset(false);
    reset?.();
  }, [reset]);

  if (!actions) {
    return null;
  }
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              aria-label={t`Workspace actions`}
              size="icon-xs"
              variant="ghost"
            />
          }
        >
          <EllipsisIcon aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem disabled={!writable} onClick={chooseFiles}>
            <UploadIcon aria-hidden />
            <Trans>Upload files…</Trans>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={actions.refresh}>
            <RefreshCwIcon aria-hidden />
            <Trans>Refresh</Trans>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={!reset}
            onClick={askReset}
            variant="destructive"
          >
            <RotateCcwIcon aria-hidden />
            <Trans>Reset workspace…</Trans>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <input
        aria-hidden
        className="hidden"
        multiple
        onChange={chosen}
        ref={upload}
        tabIndex={-1}
        type="file"
      />
      <AlertDialog onOpenChange={setConfirmReset} open={confirmReset}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <Trans>Reset the workspace?</Trans>
            </AlertDialogTitle>
            <AlertDialogDescription>
              <Trans>
                Every file in it is deleted and it starts again empty, for you
                and the agent. This can't be undone.
              </Trans>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <Trans>Cancel</Trans>
            </AlertDialogCancel>
            <AlertDialogAction onClick={doReset} variant="destructive">
              <Trans>Reset</Trans>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function EmptyFiles({
  newChat,
  onNewFile,
  writable,
}: {
  readonly newChat: boolean;
  readonly onNewFile: () => void;
  readonly writable: boolean;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <FileIcon aria-hidden className="size-6 text-muted-foreground" />
      <p className="max-w-64 text-muted-foreground text-sm">
        {newChat ? (
          <Trans>
            No files yet. Files you and the agent create will appear here.
          </Trans>
        ) : (
          <Trans>
            No files yet. Ask for one, drop a file here, or type /new-file
          </Trans>
        )}
      </p>
      <Button
        disabled={!writable}
        onClick={onNewFile}
        size="sm"
        variant="outline"
      >
        <PlusIcon aria-hidden data-icon="inline-start" />
        <Trans>New file</Trans>
      </Button>
    </div>
  );
}

/** The artifact's title, versions and tabs, in the view's one header row (075). */
const artifactHeader = (content: ReactNode) => (
  <ViewHeader>{content}</ViewHeader>
);

function MainArea({
  artifacts,
  focusView,
  main,
  modes,
  onModeChange,
  onNewFile,
  onPageMode,
  onSelect,
  onViewFocused,
  selection,
  view,
  writable,
}: {
  readonly artifacts: WorkspaceArtifacts;
  /** The file Enter opened, until focus is in it. */
  readonly focusView: string | null;
  readonly main: RefObject<HTMLDivElement | null>;
  readonly modes: Readonly<Record<string, FileMode>>;
  readonly onModeChange: (path: string, mode: FileMode) => void;
  readonly onNewFile: () => void;
  /** Taking turns: an HTML file's switch to its page in the browser. */
  readonly onPageMode: ((mode: FileMode) => void) | null;
  readonly onSelect: (selection: WorkspaceSelection | null) => void;
  readonly onViewFocused: () => void;
  /** The files half's selection (the Preview is in the other half). */
  readonly selection: WorkspaceSelection | null;
  readonly view: FilesView;
  readonly writable: boolean;
}) {
  const selectArtifact = useCallback(
    (next: ArtifactSelection) => onSelect({ kind: "artifact", ...next }),
    [onSelect]
  );
  const selectedPath = selection?.kind === "file" ? selection.path : null;
  const changeMode = useCallback(
    (next: FileMode) => {
      if (selectedPath) {
        onModeChange(selectedPath, next);
      }
    },
    [onModeChange, selectedPath]
  );
  const { actions, status } = view;

  // A rendered file has no editor to focus: the view itself takes it, once
  // the file is open (the editor focuses itself; see `FileView`). An HTML
  // file renders in the browser half: here it's code.
  const kind =
    selectedPath && renderedKind(selectedPath) === "markdown"
      ? "markdown"
      : null;
  const mode = selectedPath
    ? openingMode(modes[selectedPath], false)
    : "rendered";
  const opened = view.open?.kind === "text" ? view.open.path : null;
  useEffect(() => {
    if (focusView && kind && mode === "rendered" && opened === focusView) {
      const target =
        main.current?.querySelector<HTMLElement>("[data-view-focus]") ??
        main.current;
      target?.focus({ preventScroll: true });
      onViewFocused();
    }
  }, [focusView, kind, main, mode, onViewFocused, opened]);

  if (selection?.kind === "artifact") {
    const artifact =
      artifacts.artifacts.find((each) => each.id === selection.artifactId) ??
      artifacts.artifacts[0];
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <ArtifactView
          artifact={artifact}
          editing={artifacts.editing}
          error={artifacts.error}
          header={artifactHeader}
          onSelect={selectArtifact}
          runtimeOrigin={artifacts.runtimeOrigin}
          versionId={selection.versionId}
          versions={artifacts.versions}
        />
      </div>
    );
  }
  if (selection?.kind === "file" && actions) {
    const file = view.open ?? {
      kind: "loading" as const,
      path: selection.path,
    };
    const fileView = {
      autoFocus: focusView === selection.path,
      file,
      onAutoFocus: onViewFocused,
      onDelete: actions.deleteOpen,
      onEdit: actions.edit,
      onOverwrite: actions.overwrite,
      onReload: actions.reload,
      onSave: actions.save,
    };
    if (kind) {
      return (
        <RenderedFile {...fileView} mode={mode} onModeChange={changeMode} />
      );
    }
    return (
      <FileView
        {...fileView}
        modeToggle={
          onPageMode && file.kind === "text" ? (
            <ModeToggle mode="code" onModeChange={onPageMode} />
          ) : undefined
        }
      />
    );
  }
  if (status.kind === "off") {
    return (
      <>
        <ViewHeader />
        <p className="p-4 text-muted-foreground text-sm">
          <Trans>Sandboxes are turned off on this server.</Trans>
        </p>
      </>
    );
  }
  if (view.paths && view.paths.length > 0) {
    return (
      <>
        <ViewHeader />
        <div className="flex flex-1 items-center justify-center p-6 text-muted-foreground text-sm">
          <Trans>Select a file to open it.</Trans>
        </div>
      </>
    );
  }
  return (
    <>
      <ViewHeader />
      <EmptyFiles
        newChat={status.kind === "new-chat"}
        onNewFile={onNewFile}
        writable={writable}
      />
    </>
  );
}
