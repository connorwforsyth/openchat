"use client";

import { Plural, Trans, useLingui } from "@lingui/react/macro";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  DownloadIcon,
  FileTextIcon,
  PlayIcon,
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
  useRef,
  useState,
} from "react";

import { artifactFileName } from "../model/artifacts";
import { useDocumentTheme, useParentOrigin } from "./artifact-preview";
import { downloadFile } from "./document/export";
import {
  type ExportFormat,
  type FrameMessage,
  type HostMessage,
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

/** The presenter's keys, as the action each one is. */
export const presentKeyAction = (
  key: string
): PresentAction | "close" | "notes" | null => {
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

export interface PresentationPreviewProps {
  readonly content: string;
  /** Overrides how messages reach the frame, for tests. */
  readonly post?: PostToFrame;
  /** The runtime's origin; a deck has no preview without it. */
  readonly runtimeOrigin: string;
  readonly title: string;
}

export function PresentationPreview({
  content,
  post = postToFrame,
  runtimeOrigin,
  title,
}: PresentationPreviewProps) {
  const { t } = useLingui();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const lastId = useRef(0);
  const lastExport = useRef(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<RuntimeError | null>(null);
  const [height, setHeight] = useState<number | null>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const [presenting, setPresenting] = useState(false);
  const [notesOpen, setNotesOpen] = useState(true);
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
    setError(null);
    send({
      channel: RUNTIME_CHANNEL,
      code: content,
      fileName: artifactFileName(title, "presentation", null),
      id: String(lastId.current),
      kind: "presentation",
      theme,
      title,
      type: "render",
    });
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: these are the triggers; `render` reads them.
  useEffect(() => render(), [ready, content, theme, title]);

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
        return;
      case "error":
        if (value.id === current) {
          setError(value.error);
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
    } else {
      present(action);
    }
  });

  useEffect(() => {
    if (!presenting) {
      return;
    }
    const listener = (event: KeyboardEvent) => onKey(event);
    // Leaving full screen with the browser's own Escape ends presenting too.
    const onFullscreen = () => {
      if (!document.fullscreenElement) {
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
  }, [present, presenting]);

  const next = useCallback(() => present("next"), [present]);
  const previous = useCallback(() => present("previous"), [present]);
  const toggleNotes = useCallback(() => setNotesOpen((open) => !open), []);

  if (!parentOrigin) {
    return null;
  }
  const slide = position ? position.slide + 1 : 0;
  const slides = position?.slides ?? 0;
  const notes = position?.notes ?? "";

  return (
    <div className="flex flex-1 flex-col">
      <DeckToolbar
        exporting={exporting}
        onExportPdf={exportPdf}
        onExportPptx={exportPptx}
        onPresent={start}
        ready={ready}
        slides={slides}
      />
      {error ? <DeckError error={error} /> : null}
      {exportError ? (
        <p
          className="bg-destructive/5 px-4 py-2 text-destructive text-sm"
          role="alert"
        >
          <Trans>The deck couldn't be exported: {exportError}</Trans>
        </p>
      ) : null}
      {ready ? null : (
        <span className="sr-only" role="status">
          <Trans>Loading preview</Trans>
        </span>
      )}
      {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: aria-modal is set only while the role is dialog. */}
      <section
        // Presenting, the same frame covers the window: moving it would
        // reload it. No transition (D28).
        aria-label={presenting ? t`Presenting ${title}` : t`Slides of ${title}`}
        aria-modal={presenting ? true : undefined}
        className={cn(
          "flex flex-1 flex-col",
          presenting && "fixed inset-0 z-50 bg-background"
        )}
        ref={stageRef}
        role={presenting ? "dialog" : undefined}
      >
        <iframe
          className={cn(
            "block min-h-80 w-full bg-background",
            (presenting || height === null) && "flex-1",
            // Presenting, the keys and clicks are this side's.
            presenting && "pointer-events-none"
          )}
          ref={frameRef}
          referrerPolicy="no-referrer"
          sandbox="allow-scripts"
          src={runtimeUrl(runtimeOrigin, parentOrigin, "presentation")}
          style={presenting || height === null ? undefined : { height }}
          tabIndex={presenting ? -1 : undefined}
          title={t`Preview of ${title}`}
        />
        {presenting ? (
          <PresenterBar
            notes={notesOpen ? notes : ""}
            notesOpen={notesOpen}
            onExit={stop}
            onNext={next}
            onPrevious={previous}
            onToggleNotes={toggleNotes}
            slide={slide}
            slides={slides}
          />
        ) : null}
      </section>
    </div>
  );
}

function DeckToolbar({
  exporting,
  onExportPdf,
  onExportPptx,
  onPresent,
  ready,
  slides,
}: {
  readonly exporting: ExportFormat | null;
  readonly onExportPdf: () => void;
  readonly onExportPptx: () => void;
  readonly onPresent: () => void;
  readonly ready: boolean;
  readonly slides: number;
}) {
  return (
    <div className="flex h-10 shrink-0 items-center gap-1 border-b px-2">
      <span
        aria-live="polite"
        className="min-w-0 flex-1 truncate ps-1 text-muted-foreground text-xs tabular-nums"
      >
        {slides > 0 ? (
          <Plural one="# slide" other="# slides" value={slides} />
        ) : null}
      </span>
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
          <DropdownMenuItem onClick={onExportPptx}>
            <Trans>PowerPoint (.pptx)</Trans>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onExportPdf}>
            <Trans>PDF (.pdf)</Trans>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        disabled={!ready || slides === 0}
        onClick={onPresent}
        size="sm"
        variant="secondary"
      >
        <PlayIcon aria-hidden />
        <Trans>Present</Trans>
      </Button>
    </div>
  );
}

/** Presenting: the notes, where the presenter is, and the way out. */
function PresenterBar({
  notes,
  notesOpen,
  onExit,
  onNext,
  onPrevious,
  onToggleNotes,
  slide,
  slides,
}: {
  readonly notes: string;
  readonly notesOpen: boolean;
  readonly onExit: () => void;
  readonly onNext: () => void;
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
        <Button onClick={onExit} size="sm" variant="ghost">
          <XIcon aria-hidden />
          <Trans>Exit</Trans>
        </Button>
      </div>
    </div>
  );
}

function DeckError({ error }: { readonly error: RuntimeError }) {
  return (
    <div className="flex gap-2 bg-destructive/5 px-4 py-3 text-sm" role="alert">
      <CircleAlertIcon
        aria-hidden
        className="mt-0.5 size-4 shrink-0 text-destructive"
      />
      <div className="min-w-0 flex-1">
        <p className="text-destructive">
          <Trans>A slide in this deck failed to draw.</Trans>
        </p>
        {error.message ? (
          <pre className="mt-1 overflow-x-auto whitespace-pre-wrap font-mono text-muted-foreground text-xs">
            {error.message}
          </pre>
        ) : null}
      </div>
    </div>
  );
}
