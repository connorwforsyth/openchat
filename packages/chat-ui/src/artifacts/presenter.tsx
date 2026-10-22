"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  RotateCcwIcon,
} from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import { z } from "zod";

import { artifactFileName } from "../model/artifacts";
import { useDocumentTheme, useParentOrigin } from "./artifact-preview";
import {
  type HostMessage,
  type PresentAction,
  presentActionSchema,
  RUNTIME_CHANNEL,
  readFrameMessage,
  runtimeUrl,
} from "./runtime-protocol";

// The presenter view (n2): a second window, on the laptop while the deck
// is on the projector, with the slide being shown, the next one, the
// speaker notes and a timer. It holds no deck of its own: the panel that
// presents sends it over a BroadcastChannel (same origin, any window), and
// the keys pressed here go back as the same actions the panel's keys are.
// Each slide is drawn by its own runtime frame, stepped to its place.
// Nothing animates (D28).

/** What the panel and the presenter window say to each other. */
export const presenterMessageSchema = z.discriminatedUnion("type", [
  /** Presenter → panel: send the deck and where you are. */
  z.object({ type: z.literal("hello") }),
  /** Panel → presenter: the deck, and when presenting began (epoch ms). */
  z.object({
    content: z.string(),
    startedAt: z.number(),
    title: z.string().max(200),
    type: z.literal("deck"),
  }),
  /** Panel → presenter: where the audience is. */
  z.object({
    notes: z.string(),
    slide: z.number().int().min(0),
    slides: z.number().int().min(0),
    step: z.number().int().min(0),
    type: z.literal("position"),
  }),
  /** Presenter → panel: move, as the panel's own keys would. */
  z.object({ action: presentActionSchema, type: z.literal("command") }),
  /** Panel → presenter: presenting stopped. */
  z.object({ type: z.literal("ended") }),
]);
export type PresenterMessage = z.infer<typeof presenterMessageSchema>;

/** The channel one presenting session talks on. */
export const presenterChannelName = (session: string): string =>
  `artifact-presenter/${session}`;

/** Where the presenter window lives, for `window.open`. */
export const presenterPath = (session: string): string =>
  `/present?session=${encodeURIComponent(session)}`;

export interface DeckSpot {
  readonly slide: number;
  readonly step: number;
}

/**
 * The action that moves a frame at `at` toward `target`, or `null` once
 * it's there. Steps count within a slide, so slide order decides first.
 * Pure.
 */
export const stepToward = (
  at: DeckSpot,
  target: DeckSpot
): "next" | "previous" | null => {
  if (at.slide === target.slide && at.step === target.step) {
    return null;
  }
  const before =
    at.slide < target.slide ||
    (at.slide === target.slide && at.step < target.step);
  return before ? "next" : "previous";
};

/** Elapsed time as the presenter reads it: `m:ss`, or `h:mm:ss`. Pure. */
export const clockOf = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
    : `${minutes}:${seconds}`;
};

const postToFrame = (frame: Window, message: HostMessage) =>
  frame.postMessage(message, "*");

/**
 * One slide of the deck, drawn by the runtime and stepped to `target`.
 * The frame reports each move, so it's driven one action at a time until
 * it's there, or until a move changes nothing (the deck's end).
 */
function DeckFrame({
  content,
  label,
  runtimeOrigin,
  target,
  title,
}: {
  readonly content: string;
  readonly label: string;
  readonly runtimeOrigin: string;
  readonly target: DeckSpot;
  readonly title: string;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const renderId = useRef(0);
  const [ready, setReady] = useState(false);
  const [at, setAt] = useState<DeckSpot | null>(null);
  const lastMove = useRef<{ from: DeckSpot; action: PresentAction } | null>(
    null
  );
  const theme = useDocumentTheme();
  const parentOrigin = useParentOrigin();

  const send = useCallback((message: HostMessage) => {
    const frame = frameRef.current?.contentWindow;
    if (frame) {
      postToFrame(frame, message);
    }
  }, []);

  const present = useCallback(
    (action: PresentAction) =>
      send({
        action,
        channel: RUNTIME_CHANNEL,
        id: String(renderId.current),
        type: "present",
      }),
    [send]
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: these are the triggers for a fresh render.
  useEffect(() => {
    if (!ready) {
      return;
    }
    renderId.current += 1;
    setAt(null);
    lastMove.current = null;
    send({
      channel: RUNTIME_CHANNEL,
      code: content,
      fileName: artifactFileName(title, "presentation", null),
      id: String(renderId.current),
      kind: "presentation",
      theme,
      title,
      type: "render",
    });
  }, [ready, content, theme, title]);

  useEffect(() => {
    if (at === null) {
      return;
    }
    const action = stepToward(at, target);
    const last = lastMove.current;
    const stuck =
      last !== null &&
      last.action === action &&
      last.from.slide === at.slide &&
      last.from.step === at.step;
    if (action === null || stuck) {
      return;
    }
    lastMove.current = { action, from: at };
    present(action);
  }, [at, present, target]);

  const onMessage = useEffectEvent((event: MessageEvent) => {
    const message = readFrameMessage(event, frameRef.current?.contentWindow);
    if (!message.ok) {
      return;
    }
    const { value } = message;
    if (value.type === "ready") {
      setReady(true);
    } else if (
      value.type === "position" &&
      value.id === String(renderId.current)
    ) {
      // The deck reports once it's drawn; only then can it be presented.
      if (value.presenting) {
        setAt({ slide: value.slide, step: value.step });
      } else {
        present("enter");
      }
    }
  });

  useEffect(() => {
    const listener = (event: MessageEvent) => onMessage(event);
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, []);

  if (!parentOrigin) {
    return null;
  }
  return (
    <iframe
      className="pointer-events-none block aspect-video w-full rounded-md border bg-background"
      ref={frameRef}
      referrerPolicy="no-referrer"
      sandbox="allow-scripts"
      src={runtimeUrl(runtimeOrigin, parentOrigin, "presentation")}
      tabIndex={-1}
      title={label}
    />
  );
}

type Deck = Extract<PresenterMessage, { type: "deck" }>;
type Position = Extract<PresenterMessage, { type: "position" }>;

const usePresenterChannel = (
  session: string,
  onMessage: (message: PresenterMessage) => void
) => {
  const channelRef = useRef<BroadcastChannel | null>(null);
  const receive = useEffectEvent(onMessage);
  useEffect(() => {
    const channel = new BroadcastChannel(presenterChannelName(session));
    channelRef.current = channel;
    channel.onmessage = (event: MessageEvent) => {
      const parsed = presenterMessageSchema.safeParse(event.data);
      if (parsed.success) {
        receive(parsed.data);
      }
    };
    channel.postMessage({ type: "hello" } satisfies PresenterMessage);
    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, [session]);
  return useCallback(
    (message: PresenterMessage) => channelRef.current?.postMessage(message),
    []
  );
};

const useClock = (startedAt: number | null): string => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return clockOf(startedAt === null ? 0 : now - startedAt);
};

export interface PresenterWindowProps {
  /** The artifact runtime's origin; the slides are drawn there. */
  readonly runtimeOrigin: string | null;
  /** The presenting session to join (`presenterPath`). */
  readonly session: string;
}

/** The presenter window: current and next slide, notes, timer, keys. */
export function PresenterWindow({
  runtimeOrigin,
  session,
}: PresenterWindowProps) {
  const { t } = useLingui();
  const [deck, setDeck] = useState<Deck | null>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const [ended, setEnded] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const clock = useClock(startedAt);

  const post = usePresenterChannel(session, (message) => {
    switch (message.type) {
      case "deck":
        setDeck(message);
        setStartedAt(message.startedAt);
        setEnded(false);
        return;
      case "position":
        setPosition(message);
        setEnded(false);
        return;
      case "ended":
        setEnded(true);
        return;
      case "hello":
      case "command":
        return;
      default:
        return message satisfies never;
    }
  });

  const command = useCallback(
    (action: PresentAction) => post({ action, type: "command" }),
    [post]
  );
  const next = useCallback(() => command("next"), [command]);
  const previous = useCallback(() => command("previous"), [command]);
  const resetClock = useCallback(() => setStartedAt(Date.now()), []);

  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }
    const action = presenterKeyAction(event.key);
    if (action) {
      event.preventDefault();
      command(action);
    }
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKey(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  const title = deck?.title ?? "";
  useEffect(() => {
    document.title = title ? t`Presenter view: ${title}` : t`Presenter view`;
  }, [t, title]);

  if (runtimeOrigin === null) {
    return (
      <main className="grid min-h-svh place-items-center p-6 text-muted-foreground text-sm">
        <Trans>
          Preview unavailable: the artifacts service isn't set up here.
        </Trans>
      </main>
    );
  }
  if (deck === null || position === null) {
    return (
      <main className="grid min-h-svh place-items-center p-6 text-muted-foreground text-sm">
        <p role="status">
          <Trans>
            Waiting for the presentation. Start presenting in the chat.
          </Trans>
        </p>
      </main>
    );
  }

  const current: DeckSpot = { slide: position.slide, step: position.step };
  const hasNext = position.slide + 1 < position.slides;
  return (
    <main className="flex h-svh flex-col gap-4 bg-background p-4 text-foreground">
      <header className="flex items-center gap-3">
        <h1 className="min-w-0 flex-1 truncate font-medium text-sm">{title}</h1>
        <span
          aria-live="polite"
          className="text-muted-foreground text-sm tabular-nums"
        >
          <Trans>
            Slide {position.slide + 1} of {position.slides}
          </Trans>
        </span>
        <span
          aria-label={t`Time presenting`}
          className="font-medium font-mono text-2xl tabular-nums"
          role="timer"
        >
          {clock}
        </span>
        <Button
          aria-label={t`Restart the timer`}
          onClick={resetClock}
          size="icon-sm"
          variant="ghost"
        >
          <RotateCcwIcon aria-hidden />
        </Button>
      </header>
      {ended ? (
        <p className="text-muted-foreground text-sm" role="status">
          <Trans>Presenting has ended.</Trans>
        </p>
      ) : null}
      <div className="grid min-h-0 flex-1 grid-cols-[2fr_1fr] gap-4">
        <section
          aria-label={t`Current slide`}
          className="flex min-h-0 flex-col gap-2"
        >
          <DeckFrame
            content={deck.content}
            label={t`Current slide`}
            runtimeOrigin={runtimeOrigin}
            target={current}
            title={title}
          />
          <div className="flex items-center gap-1">
            <Button onClick={previous} size="sm" variant="outline">
              <ChevronLeftIcon aria-hidden />
              <Trans>Previous</Trans>
            </Button>
            <Button onClick={next} size="sm" variant="outline">
              <Trans>Next</Trans>
              <ChevronRightIcon aria-hidden />
            </Button>
          </div>
        </section>
        <div className="flex min-h-0 flex-col gap-4">
          <section aria-label={t`Next slide`} className="flex flex-col gap-2">
            <h2 className="text-muted-foreground text-xs">
              <Trans>Next</Trans>
            </h2>
            {hasNext ? (
              <DeckFrame
                content={deck.content}
                label={t`Next slide`}
                runtimeOrigin={runtimeOrigin}
                target={{ slide: position.slide + 1, step: 0 }}
                title={title}
              />
            ) : (
              <p className="grid aspect-video place-items-center rounded-md border text-muted-foreground text-sm">
                <Trans>End of the deck</Trans>
              </p>
            )}
          </section>
          <section
            aria-label={t`Speaker notes`}
            className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap rounded-md border p-4 text-lg leading-relaxed"
          >
            {position.notes || (
              <span className="text-muted-foreground text-sm">
                <Trans>No notes for this slide.</Trans>
              </span>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

/** The presenter window's keys: the panel's, with Escape ending the talk. */
export const presenterKeyAction = (key: string): PresentAction | null => {
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
      return "exit";
    default:
      return null;
  }
};
