"use client";

import { Plural, Trans, useLingui } from "@lingui/react/macro";
import type { SlideTarget } from "@workspace/artifacts-kit/kinds/presentation/edit-target";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  DownloadIcon,
  FileTextIcon,
  MonitorIcon,
  PlayIcon,
  RefreshCwIcon,
  XIcon,
} from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { cn } from "@workspace/ui/lib/utils";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";

import { artifactFileName } from "../model/artifacts";
import { useDocumentTheme, useParentOrigin } from "./artifact-preview";
import { downloadFile } from "./document/export";
import {
  type PresenterMessage,
  presenterChannelName,
  presenterMessageSchema,
  presenterPath,
} from "./presenter";
import {
  type ExportFormat,
  type FrameMessage,
  type HostMessage,
  type PickedElement,
  type PresentAction,
  RUNTIME_CHANNEL,
  type RuntimeError,
  readFrameMessage,
  runtimeUrl,
} from "./runtime-protocol";

// A presentation (164) in the artifacts panel: the deck drawn by the
// artifact runtime (D24), every slide down the frame, with Present and
// Export. Presenting puts the same frame over the whole window (and full
// screen, where the browser allows), steps through it from the keyboard
// and shows the speaker notes; nothing animates, since it's keyboard-driven
// (D28). Exports are made in the frame, from the slides as drawn, and come
// back as bytes this side downloads: the frame's sandbox can't.

type Position = Extract<FrameMessage, { type: "position" }>;

/**
 * Whether the runtime is there to draw the deck: no origin configured, the
 * frame loading, the frame said `ready`, or it never did.
 */
export type RuntimeConnection =
  | "connecting"
  | "ready"
  | "unconfigured"
  | "unreachable";

/** How long the frame has to say `ready` before the panel says it isn't coming. */
export const RUNTIME_READY_TIMEOUT_MS = 10_000;

/** Where the panel stands with the runtime. Pure. */
export const connectionOf = (
  runtimeOrigin: string | null,
  ready: boolean,
  timedOut: boolean
): RuntimeConnection => {
  if (runtimeOrigin === null) {
    return "unconfigured";
  }
  if (ready) {
    return "ready";
  }
  return timedOut ? "unreachable" : "connecting";
};

const SLIDE_ERROR = /^slide "([^"]+)": ([\s\S]*)$/;

/** A failed slide's id and why, or the deck's own error. Pure. */
export const deckProblem = (
  error: RuntimeError
):
  | { readonly kind: "deck"; readonly message: string }
  | {
      readonly id: string;
      readonly kind: "slide";
      readonly message: string;
    } => {
  const match = SLIDE_ERROR.exec(error.message);
  return match
    ? { id: match[1] ?? "", kind: "slide", message: match[2] ?? "" }
    : { kind: "deck", message: error.message || error.kind };
};

/** The presenter's keys, as the action each one is. */
export const presentKeyAction = (
  key: string
): PresentAction | "close" | "notes" | "presenter" | null => {
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
    case "PageDown":
    case " ":
    case "Enter":
      return "next";
    case "ArrowLeft":
    case "ArrowUp":
    case "PageUp":
    case "Backspace":
      return "previous";
    case "Home":
      return "first";
    case "End":
      return "last";
    case "Escape":
      return "close";
    case "n":
    case "N":
      return "notes";
    case "p":
    case "P":
      return "presenter";
    default:
      return null;
  }
};

const MEDIA_TYPES: Readonly<Record<ExportFormat, string>> = {
  pdf: "application/pdf",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

const JSON_END = /\.json$/;

/** The exported file's name, from the deck's title. */
export const presentationFileName = (title: string, format: ExportFormat) =>
  artifactFileName(title, "presentation", null).replace(JSON_END, `.${format}`);

/** How a message reaches the frame; a port, so tests can read what's sent. */
export type PostToFrame = (frame: Window, message: HostMessage) => void;

// The frame's origin is opaque, so there's no origin to target; the deck is
// what it displays anyway.
const postToFrame: PostToFrame = (frame, message) =>
  frame.postMessage(message, "*");

/**
 * Whether the frame has had `RUNTIME_READY_TIMEOUT_MS` to say `ready` and
 * hasn't; each retry (`attempt`) starts the wait again.
 */
const useReadyTimeout = (
  ready: boolean,
  runtimeOrigin: string | null,
  attempt: number
): boolean => {
  const [timedOut, setTimedOut] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is the trigger.
  useEffect(() => {
    setTimedOut(false);
    if (ready || runtimeOrigin === null) {
      return;
    }
    const timer = window.setTimeout(
      () => setTimedOut(true),
      RUNTIME_READY_TIMEOUT_MS
    );
    return () => window.clearTimeout(timer);
  }, [attempt, ready, runtimeOrigin]);
  return timedOut;
};

/**
 * The panel's side of the presenter window: a session channel that sends
 * the deck and each position, and takes the window's commands.
 */
const usePresenterSession = ({
  content,
  onCommand,
  position,
  presenting,
  startedAt,
  title,
}: {
  readonly content: string;
  readonly onCommand: (action: PresentAction) => void;
  readonly position: Position | null;
  readonly presenting: boolean;
  readonly startedAt: number;
  readonly title: string;
}) => {
  const [session] = useState(() => crypto.randomUUID());
  const channelRef = useRef<BroadcastChannel | null>(null);
  const tell = useCallback((message: PresenterMessage) => {
    channelRef.current?.postMessage(message);
  }, []);
  const deck = useEffectEvent(() =>
    tell({ content, startedAt, title, type: "deck" })
  );
  const where = useEffectEvent(() => {
    if (position) {
      tell({
        notes: position.notes,
        slide: position.slide,
        slides: position.slides,
        step: position.step,
        type: "position",
      });
    }
  });
  const command = useEffectEvent(onCommand);

  useEffect(() => {
    const channel = new BroadcastChannel(presenterChannelName(session));
    channelRef.current = channel;
    channel.onmessage = (event: MessageEvent) => {
      const parsed = presenterMessageSchema.safeParse(event.data);
      if (!parsed.success) {
        return;
      }
      if (parsed.data.type === "hello") {
        deck();
        where();
      } else if (parsed.data.type === "command") {
        command(parsed.data.action);
      }
    };
    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, [session]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: these are the triggers; `deck` reads them.
  useEffect(() => deck(), [content, startedAt, title]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: as above, for `where`.
  useEffect(() => where(), [position]);
  useEffect(() => {
    if (!presenting) {
      tell({ type: "ended" });
    }
  }, [presenting, tell]);

  const opened = useRef<Window | null>(null);
  const open = useCallback(() => {
    opened.current = window.open(
      presenterPath(session),
      `presenter-${session}`,
      "popup,width=1280,height=800"
    );
  }, [session]);
  const isOpen = useCallback(
    () => opened.current !== null && !opened.current.closed,
    []
  );
  return useMemo(() => ({ isOpen, open }), [isOpen, open]);
};

/** Where a pick came from, as far as this side can tell. */
export interface PickSource {
  readonly epoch: number;
  readonly focused: boolean;
}

/** What the slides editor asks of the deck (n2): its canvas view. */
export interface DeckEditing {
  /** Which source the deck is drawn from; the editor moves it on when the deck changes under it. */
  readonly epoch: number;
  /** The slide shown. */
  readonly focus: string | undefined;
  /** Whether a click on the slide picks an element in it. */
  readonly inspect: boolean;
  /**
   * What the frame says was picked, with what the editor needs to judge
   * the claim: the `epoch` the render it came from was asked with, and
   * whether the frame had the person's focus.
   */
  readonly onPicked: (element: PickedElement | null, from: PickSource) => void;
  /** What's picked now, picked again when the deck is drawn again. */
  readonly selection: SlideTarget | null;
}

export interface UseDeckOptions {
  readonly content: string;
  /** The slides editor's canvas; without it, the overview. */
  readonly editing?: DeckEditing;
  /** Overrides how messages reach the frame, for tests. */
  readonly post?: PostToFrame;
  readonly runtimeOrigin: string | null;
  readonly title: string;
}

export interface PresentationPreviewProps
  extends Omit<UseDeckOptions, "editing"> {}

/**
 * A deck drawn by the runtime, presented and exported: the frame, where it
 * stands, and what can be done with it. `PresentationPreview` and the
 * slides editor lay out its pieces (`DeckActions`, `DeckNotices`,
 * `DeckStage`) as each needs.
 */
export function useDeck({
  content,
  editing,
  post = postToFrame,
  runtimeOrigin,
  title,
}: UseDeckOptions) {
  const { t } = useLingui();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  const lastId = useRef(0);
  const renderEpoch = useRef(0);
  const lastExport = useRef(0);
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [errors, setErrors] = useState<readonly RuntimeError[]>([]);
  const [height, setHeight] = useState<number | null>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const [presenting, setPresenting] = useState(false);
  const [notesOpen, setNotesOpen] = useState(true);
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const theme = useDocumentTheme();
  const parentOrigin = useParentOrigin();

  const send = useCallback(
    (message: HostMessage) => {
      const frame = frameRef.current?.contentWindow;
      if (frame) {
        post(frame, message);
      }
    },
    [post]
  );

  const render = useEffectEvent(() => {
    if (!ready) {
      return;
    }
    lastId.current += 1;
    renderEpoch.current = editing?.epoch ?? 0;
    setErrors([]);
    send({
      channel: RUNTIME_CHANNEL,
      code: content,
      fileName: artifactFileName(title, "presentation", null),
      id: String(lastId.current),
      kind: "presentation",
      theme,
      title,
      type: "render",
      ...(editing
        ? {
            focus: editing.focus,
            inspect: editing.inspect,
            selection: editing.selection,
            view: "slide" as const,
          }
        : {}),
    });
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: these are the triggers; `render` reads them.
  useEffect(() => render(), [ready, content, theme, title]);

  // Picking another slide, or nothing, without drawing the deck again.
  const select = useCallback(
    (focus: string, selection: SlideTarget | null) => {
      if (lastId.current > 0) {
        send({
          channel: RUNTIME_CHANNEL,
          focus,
          id: String(lastId.current),
          selection,
          type: "select",
        });
      }
    },
    [send]
  );

  const present = useCallback(
    (action: PresentAction) => {
      if (lastId.current > 0) {
        send({
          action,
          channel: RUNTIME_CHANNEL,
          id: String(lastId.current),
          type: "present",
        });
      }
    },
    [send]
  );

  const start = useCallback(() => {
    setPresenting(true);
    setStartedAt(Date.now());
    present("enter");
    present("first");
    // Full screen where the browser allows it; the overlay covers the
    // window either way.
    stageRef.current?.requestFullscreen?.().catch(() => undefined);
  }, [present]);

  const stop = useCallback(() => {
    setPresenting(false);
    present("exit");
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => undefined);
    }
  }, [present]);

  const presenterWindow = usePresenterSession({
    content,
    onCommand: (action) => {
      if (action === "exit") {
        stop();
      } else {
        present(action);
      }
    },
    position,
    presenting,
    startedAt,
    title,
  });

  const exportAs = useCallback(
    (format: ExportFormat) => {
      if (lastId.current === 0) {
        return;
      }
      lastExport.current += 1;
      setExporting(format);
      setExportError(null);
      send({
        channel: RUNTIME_CHANNEL,
        format,
        id: String(lastId.current),
        request: String(lastExport.current),
        type: "export",
      });
    },
    [send]
  );
  const exportPptx = useCallback(() => exportAs("pptx"), [exportAs]);
  const exportPdf = useCallback(() => exportAs("pdf"), [exportAs]);

  const onMessage = useEffectEvent((event: MessageEvent) => {
    const message = readFrameMessage(event, frameRef.current?.contentWindow);
    if (!message.ok) {
      return;
    }
    const { value } = message;
    const current = String(lastId.current);
    switch (value.type) {
      case "ready":
        if (ready) {
          render();
        } else {
          setReady(true);
        }
        return;
      case "rendered":
      case "layout":
        return;
      case "error":
        if (value.id === current) {
          setErrors((known) => [...known, value.error]);
        }
        return;
      case "resize":
        setHeight(value.height);
        return;
      case "position":
        if (value.id === current) {
          setPosition(value);
        }
        return;
      case "picked":
        if (value.id === current && editing) {
          editing.onPicked(value.element, {
            epoch: renderEpoch.current,
            focused: document.activeElement === frameRef.current,
          });
        }
        return;
      case "exported":
        if (value.request === String(lastExport.current)) {
          setExporting(null);
          downloadFile(
            new Blob([value.data], { type: MEDIA_TYPES[value.format] }),
            presentationFileName(title, value.format)
          );
        }
        return;
      case "export-failed":
        if (value.request === String(lastExport.current)) {
          setExporting(null);
          setExportError(value.message);
        }
        return;
      default:
        return value satisfies never;
    }
  });

  useEffect(() => {
    const listener = (event: MessageEvent) => onMessage(event);
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, []);

  const onKey = useEffectEvent((event: KeyboardEvent) => {
    const action = presentKeyAction(event.key);
    if (action === null || event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }
    event.preventDefault();
    if (action === "close") {
      stop();
    } else if (action === "notes") {
      setNotesOpen((open) => !open);
    } else if (action === "presenter") {
      presenterWindow.open();
    } else {
      present(action);
    }
  });

  useEffect(() => {
    if (!presenting) {
      return;
    }
    const listener = (event: KeyboardEvent) => onKey(event);
    // Leaving full screen with the browser's own Escape ends presenting
    // too, unless a presenter window is open: the browser leaves full
    // screen when one opens, and the talk goes on.
    const onFullscreen = () => {
      if (!(document.fullscreenElement || presenterWindow.isOpen())) {
        setPresenting(false);
        present("exit");
      }
    };
    window.addEventListener("keydown", listener);
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => {
      window.removeEventListener("keydown", listener);
      document.removeEventListener("fullscreenchange", onFullscreen);
    };
  }, [present, presenterWindow, presenting]);

  const timedOut = useReadyTimeout(ready, runtimeOrigin, attempt);

  const retry = useCallback(() => {
    setReady(false);
    setAttempt((count) => count + 1);
  }, []);

  const next = useCallback(() => present("next"), [present]);
  const previous = useCallback(() => present("previous"), [present]);
  const toggleNotes = useCallback(() => setNotesOpen((open) => !open), []);

  return {
    attempt,
    connection: connectionOf(runtimeOrigin, ready, timedOut),
    errors,
    exportError,
    exporting,
    exportPdf,
    exportPptx,
    frameRef,
    height,
    label: presenting ? t`Presenting ${title}` : t`Slides of ${title}`,
    next,
    notes: position?.notes ?? "",
    notesOpen,
    openPresenter: presenterWindow.open,
    presenting,
    previous,
    ready,
    retry,
    runtimeOrigin,
    select,
    slide: position ? position.slide + 1 : 0,
    slides: position?.slides ?? 0,
    src:
      runtimeOrigin && parentOrigin
        ? runtimeUrl(runtimeOrigin, parentOrigin, "presentation")
        : null,
    stageRef,
    start,
    stop,
    title,
    toggleNotes,
    view: editing ? ("slide" as const) : ("overview" as const),
  };
}

export type Deck = ReturnType<typeof useDeck>;

export function PresentationPreview(props: PresentationPreviewProps) {
  const deck = useDeck(props);
  if (deck.runtimeOrigin === null) {
    return (
      <RuntimeUnavailable
        connection="unconfigured"
        onRetry={deck.retry}
        origin={null}
      />
    );
  }
  if (!deck.src) {
    return null;
  }
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b px-2">
        <span
          aria-live="polite"
          className="min-w-0 flex-1 truncate ps-1 text-muted-foreground text-xs tabular-nums"
        >
          {deck.slides > 0 ? (
            <Plural one="# slide" other="# slides" value={deck.slides} />
          ) : null}
        </span>
        <DeckActions deck={deck} />
      </div>
      <DeckNotices deck={deck} />
      <DeckStage deck={deck} />
    </div>
  );
}

/**
 * The deck's frame, and while presenting the same frame over the whole
 * window with the presenter's bar: moving it would reload it. In the
 * editor's `slide` view it's one slide, fitted to the pane's width.
 */
export function DeckStage({ deck }: { readonly deck: Deck }) {
  const { t } = useLingui();
  if (!deck.src) {
    return null;
  }
  const { presenting } = deck;
  const fitted = deck.view === "slide" && !presenting;
  return (
    <>
      {deck.ready ? null : (
        <span className="sr-only" role="status">
          <Trans>Loading preview</Trans>
        </span>
      )}
      {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: aria-modal is set only while the role is dialog. */}
      <section
        // No transition (D28).
        aria-label={deck.label}
        aria-modal={presenting ? true : undefined}
        className={cn(
          "flex flex-1 flex-col",
          fitted && "items-center justify-center bg-muted/30 p-3",
          presenting && "fixed inset-0 z-50 bg-background",
          // Kept loading out of sight, so a slow runtime still shows up.
          deck.connection === "unreachable" && "hidden"
        )}
        ref={deck.stageRef}
        role={presenting ? "dialog" : undefined}
      >
        <iframe
          className={cn(
            "block w-full bg-background",
            fitted ? "aspect-video max-h-full rounded-md border" : "min-h-80",
            !fitted && (presenting || deck.height === null) && "flex-1",
            // Presenting, the keys and clicks are this side's.
            presenting && "pointer-events-none"
          )}
          key={deck.attempt}
          ref={deck.frameRef}
          referrerPolicy="no-referrer"
          sandbox="allow-scripts"
          src={deck.src}
          style={
            fitted || presenting || deck.height === null
              ? undefined
              : { height: deck.height }
          }
          tabIndex={presenting ? -1 : undefined}
          title={t`Preview of ${deck.title}`}
        />
        {presenting ? (
          <PresenterBar
            notes={deck.notesOpen ? deck.notes : ""}
            notesOpen={deck.notesOpen}
            onExit={deck.stop}
            onNext={deck.next}
            onPresenter={deck.openPresenter}
            onPrevious={deck.previous}
            onToggleNotes={deck.toggleNotes}
            slide={deck.slide}
            slides={deck.slides}
          />
        ) : null}
      </section>
    </>
  );
}

/** Export and Present. */
export function DeckActions({ deck }: { readonly deck: Deck }) {
  const { exporting, ready, slides } = deck;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              disabled={!ready || exporting !== null}
              size="sm"
              variant="ghost"
            />
          }
        >
          <DownloadIcon aria-hidden />
          {exporting ? <Trans>Exporting…</Trans> : <Trans>Export</Trans>}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onClick={deck.exportPptx}>
            <Trans>PowerPoint (.pptx)</Trans>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={deck.exportPdf}>
            <Trans>PDF (.pdf)</Trans>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        disabled={!ready || slides === 0}
        onClick={deck.start}
        size="sm"
        variant="secondary"
      >
        <PlayIcon aria-hidden />
        <Trans>Present</Trans>
      </Button>
    </>
  );
}

/** Presenting: the notes, where the presenter is, and the way out. */
function PresenterBar({
  notes,
  notesOpen,
  onExit,
  onNext,
  onPresenter,
  onPrevious,
  onToggleNotes,
  slide,
  slides,
}: {
  readonly notes: string;
  readonly notesOpen: boolean;
  readonly onExit: () => void;
  readonly onNext: () => void;
  readonly onPresenter: () => void;
  readonly onPrevious: () => void;
  readonly onToggleNotes: () => void;
  readonly slide: number;
  readonly slides: number;
}) {
  const { t } = useLingui();
  return (
    <div className="flex shrink-0 flex-col border-t bg-background">
      {notes ? (
        <section
          aria-label={t`Speaker notes`}
          className="max-h-40 overflow-y-auto whitespace-pre-wrap px-6 py-3 text-sm"
        >
          {notes}
        </section>
      ) : null}
      <div className="flex h-12 items-center gap-1 px-3">
        <Button
          aria-label={t`Previous`}
          onClick={onPrevious}
          size="icon-sm"
          variant="ghost"
        >
          <ChevronLeftIcon aria-hidden />
        </Button>
        <span
          aria-live="polite"
          className="min-w-24 text-center text-muted-foreground text-xs tabular-nums"
        >
          <Trans>
            Slide {slide} of {slides}
          </Trans>
        </span>
        <Button
          aria-label={t`Next`}
          onClick={onNext}
          size="icon-sm"
          variant="ghost"
        >
          <ChevronRightIcon aria-hidden />
        </Button>
        <span className="flex-1" />
        <Button
          aria-pressed={notesOpen}
          onClick={onToggleNotes}
          size="sm"
          variant="ghost"
        >
          <FileTextIcon aria-hidden />
          <Trans>Notes</Trans>
        </Button>
        <Button onClick={onPresenter} size="sm" variant="ghost">
          <MonitorIcon aria-hidden />
          <Trans>Presenter view</Trans>
        </Button>
        <Button onClick={onExit} size="sm" variant="ghost">
          <XIcon aria-hidden />
          <Trans>Exit</Trans>
        </Button>
      </div>
    </div>
  );
}

/** What's wrong above the deck: the runtime, its slides, or an export. */
export function DeckNotices({ deck }: { readonly deck: Deck }) {
  return (
    <>
      {deck.connection === "unreachable" ? (
        <RuntimeUnavailable
          connection="unreachable"
          onRetry={deck.retry}
          origin={deck.runtimeOrigin}
        />
      ) : null}
      {deck.errors.length > 0 ? <DeckErrors errors={deck.errors} /> : null}
      {deck.exportError ? (
        <p
          className="bg-destructive/5 px-4 py-2 text-destructive text-sm"
          role="alert"
        >
          <Trans>The deck couldn't be exported: {deck.exportError}</Trans>
        </p>
      ) : null}
    </>
  );
}

/**
 * Why there's no deck: no artifact runtime is configured, or the one
 * configured isn't answering. Never the code in its place (D24).
 */
function RuntimeUnavailable({
  connection,
  onRetry,
  origin,
}: {
  readonly connection: "unconfigured" | "unreachable";
  readonly onRetry: () => void;
  readonly origin: string | null;
}) {
  return (
    <div
      className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-12 text-center"
      role="alert"
    >
      <CircleAlertIcon aria-hidden className="size-5 text-muted-foreground" />
      <p className="font-medium text-sm">
        {connection === "unconfigured" ? (
          <Trans>
            Preview unavailable: the artifacts service isn't set up here
          </Trans>
        ) : (
          <Trans>
            Preview unavailable: the artifacts service isn't running
          </Trans>
        )}
      </p>
      <p className="max-w-sm text-muted-foreground text-sm">
        {connection === "unconfigured" ? (
          <Trans>
            Slides are drawn by the artifacts service. Set ARTIFACTS_ORIGIN and
            start it with bun dev. The deck's JSON is in the Code tab.
          </Trans>
        ) : (
          <Trans>
            Nothing answered at {origin}. Start it with bun dev, then retry.
          </Trans>
        )}
      </p>
      {connection === "unreachable" ? (
        <Button onClick={onRetry} size="sm" variant="outline">
          <RefreshCwIcon aria-hidden />
          <Trans>Retry</Trans>
        </Button>
      ) : null}
    </div>
  );
}

/** Each slide that couldn't be drawn, and why; the rest of the deck still shows. */
function DeckErrors({ errors }: { readonly errors: readonly RuntimeError[] }) {
  const problems = errors.map(deckProblem);
  const slides = problems.filter((each) => each.kind === "slide").length;
  return (
    <div className="flex gap-2 bg-destructive/5 px-4 py-3 text-sm" role="alert">
      <CircleAlertIcon
        aria-hidden
        className="mt-0.5 size-4 shrink-0 text-destructive"
      />
      <div className="min-w-0 flex-1">
        <p className="text-destructive">
          {slides > 0 ? (
            <Plural
              one="# slide couldn't be drawn. The others are below."
              other="# slides couldn't be drawn. The others are below."
              value={slides}
            />
          ) : (
            <Trans>This deck couldn't be read.</Trans>
          )}
        </p>
        <ul className="mt-1 flex flex-col gap-1">
          {problems.map((problem, index) => (
            <li
              className="overflow-x-auto whitespace-pre-wrap font-mono text-muted-foreground text-xs"
              // biome-ignore lint/suspicious/noArrayIndexKey: errors arrive in order and are only ever appended.
              key={index}
            >
              {problem.kind === "slide"
                ? `${problem.id}: ${problem.message}`
                : problem.message}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
