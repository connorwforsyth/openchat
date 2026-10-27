"use client";

import { Plural, Trans, useLingui } from "@lingui/react/macro";
import type { QueryUtils } from "@workspace/client/api";
import { FileTree, type FileTreeHandle } from "@workspace/code-ui/file-tree";
import type {
  Artifact,
  ArtifactVersion,
} from "@workspace/contract/schemas/files";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  EllipsisIcon,
  FileIcon,
  GlobeIcon,
  PlusIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SearchIcon,
  TriangleAlertIcon,
  UploadIcon,
} from "@workspace/icons";
import { runnerUnavailableOf } from "@workspace/sandbox/runner/unavailable";
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
import { ResizeHandle } from "@workspace/ui/components/resizable";
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
import { kindIcon } from "../artifacts/kind-icon";
import type { PlanEditing } from "../artifacts/plan-editor";
import type { WorkspaceSection } from "../model/layout";
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
  COLUMNS_BELOW,
  clampListWidth,
  type HalfRequest,
  LIST_WIDTH_DEFAULT,
  LIST_WIDTH_MIN,
  listWidthMax,
  type Maximised,
  maximisedAfter,
  maximisedForHalf,
  type PaneLayout,
  type PanelSlots,
  type PreviewSlot,
  paneLayout,
  SPLIT_DEFAULT,
  slotsAfter,
  type TurnView,
  viewForHalf,
  viewOf,
} from "./model/split";
import { NewFileDialog } from "./new-file-dialog";
import { BrowserView } from "./preview";
import { RenderedFile } from "./rendered-file";
import { RunnerUnavailableNotice } from "./runner-unavailable";
import { SaveSiteDialog } from "./save-site-dialog";
import { SplitHandle } from "./split-handle";
import { useElementHeight, useElementWidth } from "./use-element-width";
import { useFilesDock } from "./use-files-dock";
import { usePreviewHistory } from "./use-preview-history";
import { useListWidth, useSplit } from "./use-split";
import {
  type FilesView,
  staticFiles,
  useWorkspaceFiles,
} from "./use-workspace-files";
import {
  BackToListProvider,
  type RowEnd,
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
//
// Night 2 made the halves the preview and the files viewer (Connor, 27 Oct):
// the top shows the open artifact, or the browser; below, the file list sits
// beside the open file, like a code editor, with an edge that remembers its
// width. An artifact and a file stay open together (`slotsAfter`). Either
// alone takes the panel: the files fold to their row under a preview, and
// with nothing to preview they're all there is.

/** Results shown at once; more would only be scrolled past. */
const MAX_MATCHES = 200;

/** Frames to wait for a lazily drawn target (the tree's rows) to take focus. */
const FOCUS_FRAMES = 30;

export interface WorkspaceArtifacts {
  /** The API, so a Document (126) can be edited in the panel; read only without it. */
  readonly api?: QueryUtils;
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
  /** The chat's id; another chat's panel starts empty. `null` before a new chat has one. */
  readonly chatId?: string | null;
  readonly className?: string;
  readonly files: WorkspaceFilesSource;
  /** The header's last press of Browser or Files (137). */
  readonly halfRequest?: HalfRequest | null;
  readonly onSelect: (selection: WorkspaceSelection | null) => void;
  /** A page the chat asks the Preview to show (`openPreview`, an `.html` write). */
  readonly previewRequest?: PreviewRequest | null;
  /** Checks a preview answers before showing it; for tests. */
  readonly probePreview?: (url: string) => Promise<boolean>;
  /** `workspaceRevision` of the chat's messages. */
  readonly revision: number;
  /**
   * The section the panel is open on. On the browser it shows the browser
   * even before there's anything to preview (its empty state).
   */
  readonly section?: WorkspaceSection | null;
  /** What the main area shows. */
  readonly selection: WorkspaceSelection | null;
}

export function WorkspacePanel(props: WorkspacePanelProps) {
  const { files } = props;
  const slots = usePanelSlots(
    props.selection,
    props.halfRequest ?? null,
    props.chatId ?? null
  );
  return files.kind === "chat" ? (
    <ChatWorkspacePanel {...props} files={files} slots={slots} />
  ) : (
    <WorkspaceLayout {...props} slots={slots} view={staticFiles(files.kind)} />
  );
}

const NO_SLOTS: PanelSlots = { file: null, preview: null };
const BROWSER: PreviewSlot = { kind: "preview" };

/** A press of the header's Browser puts the browser on top. */
const withBrowserPress = (slots: PanelSlots, press: number | null) =>
  press === null ? slots : { ...slots, preview: BROWSER };

/**
 * What each half holds (`slotsAfter`): a pick fills its own half and keeps
 * the other, so an artifact on top and a file below stay open together.
 * The header's Browser puts the browser back on top. Another chat starts
 * empty; a new chat getting its id keeps what it has.
 */
function usePanelSlots(
  selection: WorkspaceSelection | null,
  halfRequest: HalfRequest | null,
  chatId: string | null
): PanelSlots {
  const key = selectionKey(selection);
  const press = halfRequest?.half === "browser" ? halfRequest.id : null;
  const [held, setHeld] = useState(() => ({
    chatId,
    key,
    press,
    slots: withBrowserPress(slotsAfter(NO_SLOTS, selection), press),
  }));
  const otherChat = held.chatId !== null && held.chatId !== chatId;
  if (otherChat) {
    setHeld({
      chatId,
      key,
      press,
      slots: withBrowserPress(slotsAfter(NO_SLOTS, selection), press),
    });
  } else if (
    held.key !== key ||
    held.press !== press ||
    held.chatId !== chatId
  ) {
    const picked =
      held.key === key ? held.slots : slotsAfter(held.slots, selection);
    setHeld({
      chatId,
      key,
      press,
      slots: held.press === press ? picked : withBrowserPress(picked, press),
    });
  }
  return held.slots;
}

interface LayoutProps extends WorkspacePanelProps {
  /** What each half holds: the open artifact or browser, and the open file. */
  readonly slots: PanelSlots;
}

function ChatWorkspacePanel(
  props: LayoutProps & {
    readonly files: Extract<WorkspaceFilesSource, { kind: "chat" }>;
  }
) {
  const { files, onSelect, revision, slots } = props;
  const onSelectFile = useCallback(
    (path: string | null) => onSelect(path ? { kind: "file", path } : null),
    [onSelect]
  );
  const view = useWorkspaceFiles({
    files,
    onSelectFile,
    revision,
    selectedPath: slots.file?.path ?? null,
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
      // A version is a pick of its own: the pager, an older card.
      return `artifact:${selection.artifactId ?? ""}:${selection.versionId ?? ""}`;
    case "preview":
      return "preview";
    default:
      return selection satisfies never;
  }
};

interface Turn {
  /** The header's last press, `HalfRequest.id`. */
  readonly half: number | null;
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
 * The header's Browser and Files (137) show their half, as `maximisedForHalf`
 * and `viewForHalf` say, the panel opening with one included.
 */
function usePanes({
  asked,
  halfRequest,
  request,
  selection,
}: {
  readonly asked: TurnView;
  readonly halfRequest: HalfRequest | null;
  readonly request: number | null;
  readonly selection: WorkspaceSelection | null;
}) {
  const key = selectionKey(selection);
  const press = halfRequest?.id ?? null;
  const [turn, setTurn] = useState<Turn>(() => ({
    half: press,
    key,
    maximised: halfRequest ? maximisedForHalf(null, halfRequest.half) : null,
    previewing: null,
    request,
    view: halfRequest ? viewForHalf(halfRequest.half) : asked,
  }));
  if (turn.key !== key || turn.request !== request || turn.half !== press) {
    const requested = turn.request !== request && request !== null;
    // The Preview turning up from nothing is the chat's default arriving
    // (its files listed after the panel opened), not a pick: a header press
    // still decides whose turn it is.
    const defaulted = turn.key === null && key === "preview" && press !== null;
    const picked =
      (turn.key !== key && !defaulted) || requested
        ? {
            maximised: maximisedAfter(
              turn.maximised,
              requested ? { kind: "preview" } : selection
            ),
            view: nextView(key, asked, requested, turn),
          }
        : { maximised: turn.maximised, view: turn.view };
    const pressed = turn.half !== press && halfRequest !== null;
    setTurn({
      half: press,
      key,
      maximised: pressed
        ? maximisedForHalf(picked.maximised, halfRequest.half)
        : picked.maximised,
      previewing: turn.previewing,
      request,
      view: pressed ? viewForHalf(halfRequest.half) : picked.view,
    });
  }
  const showFiles = useCallback(
    () => setTurn((current) => ({ ...current, view: "files" })),
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
    () => ({ maximise, maximised, previewing, show, showFiles, view }),
    [maximise, maximised, previewing, show, showFiles, view]
  );
}

/**
 * The halves on screen and whose turn it is. The top half shows the open
 * artifact, or the browser; on the browser's section the browser shows even
 * with nothing in it yet, to say so (137).
 */
function useHalves({
  artifacts,
  halfRequest,
  hasPreview,
  modes,
  request,
  section,
  selection,
  slots,
  width,
}: {
  readonly artifacts: readonly Artifact[];
  readonly halfRequest: HalfRequest | null;
  readonly hasPreview: boolean;
  readonly modes: Readonly<Record<string, FileMode>>;
  readonly request: number | null;
  readonly section: WorkspaceSection | null;
  readonly selection: WorkspaceSelection | null;
  readonly slots: PanelSlots;
  readonly width: number;
}) {
  const panes = usePanes({
    asked: viewOf(selection, modes),
    halfRequest,
    request,
    selection,
  });
  const browserShown = hasPreview || section === "browser";
  // An artifact this chat doesn't have (another chat's, deleted) isn't shown.
  const artifact = artifactOf(slots);
  const artifactShown =
    artifact !== null &&
    (artifact.artifactId === undefined ||
      artifacts.some((each) => each.id === artifact.artifactId));
  const layout = paneLayout({
    hasPreview: browserShown || artifactShown,
    maximised: panes.maximised,
    view: panes.view,
    width,
  });
  return {
    artifactSlot: artifactShown ? artifact : null,
    browserShown,
    layout,
    panes,
  };
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
    return "files";
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
      show(mode === "rendered" ? "browser" : "files");
    },
    [htmlPath, save, setMode, show, showFile]
  );
  return htmlPath ? change : null;
}

/** Each half's header row ends with its Maximise; only the top one with Close. */
function useRowEnds(
  layout: PaneLayout,
  maximise: (half: "browser" | "files") => void,
  maximised: Maximised,
  artifactShown: boolean
): { readonly browser: RowEnd; readonly files: RowEnd } {
  const { t } = useLingui();
  const { browser: browserShown, maximisable } = layout;
  return useMemo(
    () => ({
      browser: {
        close: true,
        maximise: maximisable
          ? {
              label: artifactShown
                ? t`Maximise the preview`
                : t`Maximise the browser`,
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
    [artifactShown, browserShown, maximisable, maximise, maximised, t]
  );
}

/**
 * The top half, the open artifact or the browser: its share of the height,
 * or all of it, or hidden.
 */
function BrowserPane({
  artifact,
  artifacts,
  backToList,
  children,
  flex,
  hidden,
  id,
  onSelect,
  rowEnd,
}: {
  /** The open artifact, over the browser while it's open. */
  readonly artifact: ArtifactSlot | null;
  readonly artifacts: WorkspaceArtifacts;
  readonly backToList: (() => void) | null;
  readonly children: ReactNode;
  readonly flex: string;
  readonly hidden: boolean;
  readonly id: string;
  readonly onSelect: (selection: WorkspaceSelection) => void;
  readonly rowEnd: RowEnd;
}) {
  const { t } = useLingui();
  return (
    <RowEndProvider value={rowEnd}>
      <BackToListProvider value={backToList}>
        {/* Hidden, not unmounted, while the files have the height: the page stays loaded. */}
        <section
          aria-label={artifact ? t`Preview` : t`Browser`}
          className="@container/view flex min-h-30 min-w-0 flex-col"
          data-slot="workspace-browser"
          hidden={hidden}
          id={id}
          style={{ flex }}
        >
          {artifact ? (
            <PanelArtifact
              artifacts={artifacts}
              onSelect={onSelect}
              slot={artifact}
            />
          ) : null}
          {/* Under an artifact, the browser keeps its page loaded. */}
          <div
            className="flex min-h-0 flex-1 flex-col"
            hidden={Boolean(artifact)}
          >
            {children}
          </div>
        </section>
      </BackToListProvider>
    </RowEndProvider>
  );
}

/** The runner's reason and fix when that's why, the server's text otherwise. */
function FailureReason({ message }: { readonly message: string }) {
  const why = runnerUnavailableOf(message);
  return why ? (
    <RunnerUnavailableNotice reason={why.reason} />
  ) : (
    <p>{message}</p>
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
            <FailureReason message={status.message} />
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
  halfRequest = null,
  onSelect,
  previewRequest,
  probePreview,
  revision,
  section = null,
  selection,
  slots,
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
  const hasPreview = preview.history !== null;
  const { artifactSlot, browserShown, layout, panes } = useHalves({
    artifacts: artifacts.artifacts,
    halfRequest,
    hasPreview,
    modes,
    request: previewRequest?.id ?? null,
    section,
    selection,
    slots,
    width,
  });
  const artifactShown = artifactSlot !== null;
  const topShown = browserShown || artifactShown;
  const split = useSplit();
  const dock = useFilesDock();
  // With nothing on top, the files are all there is: they can't fold.
  const filesOpen = dock.open || !topShown;
  const browserId = useId();

  const { set: setDock } = dock;
  useUnfoldOnFiles(halfRequest, setDock);

  const { navigate } = preview;
  const { htmlPath, htmlVersion, showFile } = useHtmlPage(
    slots.file,
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
  const columns = useFileColumns(slots.file);
  const { showFile: showFileColumn } = columns;
  const activate = useCallback(
    (next: WorkspaceSelection) => {
      select(next);
      show(viewOf(next, modes));
      if (next.kind === "file") {
        showFileColumn();
      }
    },
    [modes, select, show, showFileColumn]
  );
  // The file search: ↓/↑ show a result without leaving the search; Enter
  // (or a click) opens it and moves focus into it;
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
        show("files");
        showFileColumn();
        setFocusRequest({ kind: "view", path: match.path });
      },
      [select, show, showFileColumn, setFocusRequest]
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
  const { showFiles } = panes;
  const { showList } = columns;
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
      showFiles();
      setDock(true);
      showList();
      setFocusRequest({ kind: "search" });
    },
    [setDock, showFiles, showList, setFocusRequest]
  );

  const openNewFile = useCallback(() => setNewFileOpen(true), []);
  const drop = useFileDrop(writable, actions?.importFiles);

  const focusView = viewToFocus(focusRequest, slots.file);
  const viewFocused = useCallback(
    () => setFocusRequest(null),
    [setFocusRequest]
  );

  const rowEnds = useRowEnds(
    layout,
    panes.maximise,
    panes.maximised,
    artifactShown
  );

  const pageMode = usePageMode({
    htmlPath: layout.turns ? htmlPath : null,
    save: actions?.save,
    setMode,
    show,
    showFile,
  });

  const topLink = useTopLink({
    activate,
    artifact: artifactSlot ? shownArtifact(artifacts, artifactSlot) : null,
    browserOnScreen: layout.browser && !artifactShown,
    hasPreview,
    previewCurrent: selection?.kind === "preview",
    show,
    topOnScreen: layout.browser,
  });

  const divider = layout.divider && filesOpen;
  const resizeLabel = artifactShown
    ? t`Resize the preview`
    : t`Resize the browser`;
  return (
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: a drop target for files ("Upload files…" in the menu does the same from the keyboard), and "/" to search from anywhere in it.
    <section
      aria-label={t`Workspace`}
      className={cn(
        "relative flex h-full min-h-0 flex-col bg-background",
        className
      )}
      data-dragging={drop.dragging || undefined}
      onDragLeave={drop.onDragLeave}
      onDragOver={drop.onDragOver}
      onDrop={drop.onDrop}
      onKeyDown={onKeyDown}
      ref={measure}
    >
      <div className="flex min-h-0 flex-1 flex-col" ref={measureHeight}>
        {topShown ? (
          <BrowserPane
            artifact={artifactSlot}
            artifacts={artifacts}
            backToList={layout.turns ? showFiles : null}
            flex={divider ? `0 1 ${split.fraction * 100}%` : "1 1 0%"}
            hidden={!layout.browser}
            id={browserId}
            onSelect={select}
            rowEnd={rowEnds.browser}
          >
            {browserShown ? (
              <BrowserView
                history={preview.history}
                modeToggle={pageToggle(pageMode)}
                onNavigate={navigate}
                probe={probePreview}
                readFile={view.readFile}
                refreshKey={`${revision}:${htmlVersion}`}
                sources={sources}
              />
            ) : null}
          </BrowserPane>
        ) : null}
        {divider ? (
          <SplitHandle
            aria-controls={browserId}
            aria-label={resizeLabel}
            defaultValue={SPLIT_DEFAULT}
            height={height}
            onResize={split.setLive}
            onResizeEnd={split.save}
            value={split.fraction}
          />
        ) : null}
        <RowEndProvider value={rowEnds.files}>
          <FilesViewer
            columns={columns}
            hidden={!layout.files}
            inspector={
              /* The open file, beside the list. */
              <div
                className="@container/view flex min-h-0 min-w-0 flex-1 flex-col outline-none"
                ref={main}
                tabIndex={-1}
              >
                <MainArea
                  focusView={focusView}
                  main={main}
                  modes={modes}
                  onModeChange={setMode}
                  onNewFile={openNewFile}
                  onPageMode={pageMode}
                  onViewFocused={viewFocused}
                  selection={slots.file}
                  view={view}
                  writable={writable}
                />
              </div>
            }
            open={filesOpen}
            topShown={topShown}
          >
            <FilesDock
              active={search.active}
              foldable={topShown}
              matches={search.matches}
              onActivate={activate}
              onNewFile={openNewFile}
              onOpenMatch={search.open}
              onQueryChange={search.onChange}
              onSearchKeyDown={search.onKeyDown}
              onShowOpen={showFileColumn}
              onToggle={dock.toggle}
              open={filesOpen}
              query={search.query}
              searchInput={searchInput}
              searching={search.searching}
              selection={slots.file}
              topLink={topLink}
              tree={tree}
              view={view}
              writable={writable}
            />
          </FilesViewer>
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

/** The header's Files unfolds the files viewer as well as showing its half. */
function useUnfoldOnFiles(
  halfRequest: HalfRequest | null,
  unfold: (open: boolean) => void
) {
  const press = halfRequest?.half === "files" ? halfRequest.id : null;
  useEffect(() => {
    if (press !== null) {
      unfold(true);
    }
  }, [press, unfold]);
}

/** The file Enter opened, until focus is in it. */
const viewToFocus = (
  request: FocusRequest | null,
  file: PanelSlots["file"]
): string | null =>
  request?.kind === "view" && request.path === file?.path ? request.path : null;

const artifactOf = (slots: PanelSlots): ArtifactSlot | null =>
  slots.preview?.kind === "artifact" ? slots.preview : null;

/** An HTML file's switch to its code, in the browser's toolbar while taking turns. */
const pageToggle = (onModeChange: ((mode: FileMode) => void) | null) =>
  onModeChange ? { mode: "rendered" as const, onModeChange } : undefined;

/** The open artifact, on top. */
function PanelArtifact({
  artifacts,
  onSelect,
  slot,
}: {
  readonly artifacts: WorkspaceArtifacts;
  readonly onSelect: (selection: WorkspaceSelection) => void;
  readonly slot: ArtifactSlot;
}) {
  const select = useCallback(
    (next: ArtifactSelection) => onSelect({ kind: "artifact", ...next }),
    [onSelect]
  );
  const artifact = shownArtifact(artifacts, slot);
  // The host loads one artifact's versions at a time: another's are as
  // good as still loading.
  const { versions: loaded } = artifacts;
  const versions =
    loaded &&
    loaded.length > 0 &&
    loaded.every((version) => version.artifactId === artifact?.id)
      ? loaded
      : undefined;
  return (
    <ArtifactView
      api={artifacts.api}
      artifact={artifact}
      editing={artifacts.editing}
      error={artifacts.error}
      header={artifactHeader}
      onSelect={select}
      runtimeOrigin={artifacts.runtimeOrigin}
      versionId={slot.versionId}
      versions={versions}
    />
  );
}

type ArtifactSlot = Extract<PreviewSlot, { readonly kind: "artifact" }>;

/** The artifact a slot names: its own, or the chat's newest. */
const shownArtifact = (
  artifacts: WorkspaceArtifacts,
  slot: ArtifactSlot
): Artifact | undefined =>
  artifacts.artifacts.find((each) => each.id === slot.artifactId) ??
  artifacts.artifacts[0];

/** A row at the top of the list that leads to the top half. */
interface TopLink {
  readonly current: boolean;
  readonly icon: ReactNode;
  readonly label: string;
  readonly onClick: () => void;
}

/**
 * The way to the top half from the list while it's out of view (its turn,
 * or the files maximised): the open artifact by name, or the Preview. Under
 * an open artifact, the Preview row puts the browser back on top.
 */
function useTopLink({
  activate,
  artifact,
  browserOnScreen,
  hasPreview,
  previewCurrent,
  show,
  topOnScreen,
}: {
  readonly activate: (selection: WorkspaceSelection) => void;
  /** The artifact on top; `undefined` when its slot names none the chat has. */
  readonly artifact: Artifact | null | undefined;
  readonly browserOnScreen: boolean;
  readonly hasPreview: boolean;
  readonly previewCurrent: boolean;
  readonly show: (view: TurnView) => void;
  readonly topOnScreen: boolean;
}): TopLink | null {
  const { t } = useLingui();
  const showTop = useCallback(() => show("browser"), [show]);
  // Shows the browser on top, in its turn too.
  const showBrowser = useCallback(
    () => activate({ kind: "preview" }),
    [activate]
  );
  if (artifact && !topOnScreen) {
    const Glyph = kindIcon(artifact.kind);
    return {
      current: true,
      icon: <Glyph aria-hidden />,
      label: artifact.title,
      onClick: showTop,
    };
  }
  if (!hasPreview || browserOnScreen) {
    return null;
  }
  return {
    current: previewCurrent,
    icon: <GlobeIcon aria-hidden />,
    label: t`Preview`,
    onClick: showBrowser,
  };
}

/**
 * The files viewer's two columns (night 2): which one a narrow viewer
 * shows. Picking a file shows it; Back to the list shows the list.
 */
function useFileColumns(file: PanelSlots["file"]) {
  const [turn, setTurn] = useState<{
    readonly path: string | null;
    readonly view: "file" | "list";
  }>(() => ({ path: file?.path ?? null, view: file ? "file" : "list" }));
  const path = file?.path ?? null;
  if (turn.path !== path) {
    setTurn({ path, view: path ? "file" : "list" });
  }
  const showList = useCallback(
    () => setTurn((current) => ({ ...current, view: "list" })),
    []
  );
  const showFile = useCallback(
    () => setTurn((current) => ({ ...current, view: "file" })),
    []
  );
  const { save, setLive, value } = useListWidth();
  return useMemo(
    () => ({
      listWidth: value,
      saveListWidth: save,
      setLiveListWidth: setLive,
      showFile,
      showList,
      view: path ? turn.view : "list",
    }),
    [path, save, setLive, showFile, showList, turn.view, value]
  );
}

/**
 * The files below the preview (night 2), laid out like a code editor: the
 * file list on the left, the open file on the right, with an edge between
 * them that remembers where it was left. A narrow viewer shows one at a
 * time. Folded, it's the list's row at the foot of the panel.
 */
function FilesViewer({
  children,
  columns,
  hidden,
  inspector,
  open,
  topShown,
}: {
  /** The list. */
  readonly children: ReactNode;
  readonly columns: ReturnType<typeof useFileColumns>;
  readonly hidden: boolean;
  readonly inspector: ReactNode;
  readonly open: boolean;
  readonly topShown: boolean;
}) {
  const { t } = useLingui();
  const listId = useId();
  const [measure, width] = useElementWidth<HTMLDivElement>();
  const turns = width > 0 && width < COLUMNS_BELOW;
  const listShown = !(open && turns && columns.view === "file");
  const fileShown = open && !(turns && columns.view === "list");
  const max = listWidthMax(width);
  const listWidth = clampListWidth(columns.listWidth, width);
  return (
    <BackToListProvider value={turns ? columns.showList : null}>
      <div
        className={cn(
          "flex min-h-0 min-w-0",
          open ? "min-h-30 flex-1" : "shrink-0",
          // Folded, its row is the line under the preview.
          !open && topShown && "border-t"
        )}
        data-slot="workspace-files"
        hidden={hidden}
        ref={measure}
      >
        <div
          className={cn(
            "flex min-h-0 min-w-0 flex-col",
            open && fileShown ? "shrink-0" : "flex-1"
          )}
          hidden={!listShown}
          id={listId}
          style={open && fileShown ? { width: listWidth } : undefined}
        >
          {children}
        </div>
        {open && listShown && fileShown ? (
          <ResizeHandle
            aria-controls={listId}
            aria-label={t`Resize the file list`}
            className="z-10"
            defaultValue={Math.min(LIST_WIDTH_DEFAULT, max)}
            max={max}
            min={LIST_WIDTH_MIN}
            onResize={columns.setLiveListWidth}
            onResizeEnd={columns.saveListWidth}
            resizes="before"
            value={listWidth}
          />
        ) : null}
        <div
          className="flex min-h-0 min-w-0 flex-1 flex-col"
          hidden={!fileShown}
        >
          {inspector}
        </div>
      </div>
    </BackToListProvider>
  );
}

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

/**
 * The files viewer's list column (night 2): a row with the search, New file
 * and the menu, over the tree. Under a preview it folds to its row, and the
 * panel remembers that. Artifacts aren't listed here; they're in the
 * header's Artifacts menu, and the open one has a row leading to it.
 */
function FilesDock({
  active,
  foldable,
  matches,
  onActivate,
  onNewFile,
  onOpenMatch,
  onQueryChange,
  onSearchKeyDown,
  onShowOpen,
  onToggle,
  open,
  query,
  searchInput,
  searching,
  selection,
  topLink,
  tree,
  view,
  writable,
}: {
  readonly active: number;
  /** There's a preview to fold under; otherwise the files are all there is. */
  readonly foldable: boolean;
  readonly matches: readonly FileMatch[];
  readonly onActivate: (selection: WorkspaceSelection) => void;
  readonly onNewFile: () => void;
  readonly onOpenMatch: (match: FileMatch) => void;
  readonly onQueryChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly onSearchKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  /** Shows the open file again, picked in the list. */
  readonly onShowOpen: () => void;
  readonly onToggle: () => void;
  readonly open: boolean;
  readonly query: string;
  readonly searchInput: RefObject<HTMLInputElement | null>;
  readonly searching: boolean;
  readonly selection: WorkspaceSelection | null;
  /** The way to the top half when it's out of view. */
  readonly topLink: TopLink | null;
  readonly tree: RefObject<FileTreeHandle | null>;
  readonly view: FilesView;
  readonly writable: boolean;
}) {
  const { t } = useLingui();
  const results = useId();
  const body = useId();

  // Directories expand in place; only files open. The tree also reports
  // the selection it was given (the open file); that's not a pick.
  const openPath = selection?.kind === "file" ? selection.path : null;
  const selectFile = useCallback(
    (selected: readonly string[]) => {
      const path = selected.at(-1);
      if (!path || path.endsWith("/")) {
        return;
      }
      if (path !== openPath) {
        onActivate({ kind: "file", path });
      }
    },
    [onActivate, openPath]
  );
  // The open file's row is already selected, so picking it again isn't a
  // selection change: a narrow viewer showing the list goes back to it.
  const reopen = useCallback(
    (event: MouseEvent | KeyboardEvent) => {
      if (
        openPath !== null &&
        ("button" in event || event.key === "Enter") &&
        rowPathOf(event) === openPath
      ) {
        onShowOpen();
      }
    },
    [onShowOpen, openPath]
  );
  const activeId = active >= 0 ? `${results}-${active}` : undefined;
  useEffect(() => {
    if (activeId) {
      document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
    }
  }, [activeId]);

  return (
    <nav
      aria-label={t`Files`}
      className="flex min-h-0 flex-1 flex-col"
      data-slot="workspace-files-dock"
    >
      {/* Open, the row lines up with the open file's header (one hairline). */}
      <div
        className={cn(
          "flex shrink-0 items-center gap-1 px-2",
          open ? "h-12 border-b" : "h-10"
        )}
      >
        {foldable ? (
          <Button
            aria-controls={body}
            aria-expanded={open}
            className="shrink-0 gap-1 px-1.5 font-medium text-muted-foreground text-xs"
            onClick={onToggle}
            size="sm"
            variant="ghost"
          >
            {open ? (
              <ChevronDownIcon aria-hidden />
            ) : (
              <ChevronUpIcon aria-hidden />
            )}
            <Trans>Files</Trans>
          </Button>
        ) : (
          <span className="px-1.5 font-medium text-muted-foreground text-xs">
            <Trans>Files</Trans>
          </span>
        )}
        <Button
          aria-label={t`New file`}
          className="ms-auto shrink-0"
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
      {/* A search field on its own line: no frame, a ring on focus. */}
      <div
        className="mx-2 mt-2 flex h-7 min-w-0 shrink-0 items-center gap-1.5 rounded-md ps-1.5 pe-1 focus-within:ring-2 focus-within:ring-ring/50"
        hidden={!open}
      >
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
      <div className="flex min-h-0 flex-1 flex-col" hidden={!open} id={body}>
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
          className="flex min-h-0 flex-1 flex-col px-2 pt-1 pb-2"
          hidden={searching}
        >
          {topLink ? (
            <ul>
              <ListItem
                current={topLink.current}
                icon={topLink.icon}
                label={topLink.label}
                onClick={topLink.onClick}
              />
            </ul>
          ) : null}
          {/* biome-ignore lint/a11y/noStaticElementInteractions: listens to the tree's own rows (focusable treeitems) as they bubble out of its shadow root. */}
          {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: the same. */}
          <div
            className="flex min-h-0 flex-1 flex-col"
            onClick={reopen}
            onKeyDown={reopen}
          >
            <FilesList
              onSelectFiles={selectFile}
              selectedPath={openPath}
              tree={tree}
              view={view}
            />
          </div>
        </div>
      </div>
    </nav>
  );
}

/** The tree row an event came from, through the tree's shadow root. */
const rowPathOf = (event: MouseEvent | KeyboardEvent): string | null => {
  for (const target of event.nativeEvent.composedPath()) {
    if (target instanceof HTMLElement && target.dataset.itemPath) {
      return target.dataset.itemPath;
    }
  }
  return null;
};

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
  const [savingSite, setSavingSite] = useState(false);
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
  const askSaveSite = useCallback(() => setSavingSite(true), []);
  const saveAsSite = actions?.saveAsSite;
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
          {saveAsSite ? (
            <DropdownMenuItem disabled={!writable} onClick={askSaveSite}>
              <GlobeIcon aria-hidden />
              <Trans>Save as site…</Trans>
            </DropdownMenuItem>
          ) : null}
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
      {saveAsSite ? (
        <SaveSiteDialog
          onOpenChange={setSavingSite}
          onSave={saveAsSite}
          open={savingSite}
        />
      ) : null}
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

/** The open file, beside the list: its editor or rendered view, or a prompt to pick one. */
function MainArea({
  focusView,
  main,
  modes,
  onModeChange,
  onNewFile,
  onPageMode,
  onViewFocused,
  selection,
  view,
  writable,
}: {
  /** The file Enter opened, until focus is in it. */
  readonly focusView: string | null;
  readonly main: RefObject<HTMLDivElement | null>;
  readonly modes: Readonly<Record<string, FileMode>>;
  readonly onModeChange: (path: string, mode: FileMode) => void;
  readonly onNewFile: () => void;
  /** Taking turns: an HTML file's switch to its page in the browser. */
  readonly onPageMode: ((mode: FileMode) => void) | null;
  readonly onViewFocused: () => void;
  /** The open file. */
  readonly selection: PanelSlots["file"];
  readonly view: FilesView;
  readonly writable: boolean;
}) {
  const selectedPath = selection?.path ?? null;
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

  if (selection && actions) {
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
