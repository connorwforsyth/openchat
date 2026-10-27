"use client";

import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import type { AnnotationMark } from "@workspace/ai/messages/annotations";
import type { ArtifactVersionId } from "@workspace/contract/schemas/common";
import type {
  Artifact,
  ArtifactVersion,
} from "@workspace/contract/schemas/files";
import {
  SendIcon,
  SquareDashedMousePointerIcon,
  Trash2Icon,
} from "@workspace/icons";
import { useShortcut } from "@workspace/shortcuts/react/use-shortcut";
import { Button } from "@workspace/ui/components/button";
import { Textarea } from "@workspace/ui/components/textarea";
import { cn } from "@workspace/ui/lib/utils";
import {
  type ChangeEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { type DraftNote, sendable, useDrafts } from "./drafts";
import { clientBox, type Locator, locate } from "./locate";
import {
  anchorOf,
  fractionIn,
  markFrom,
  moveCursor,
  type Point,
} from "./marks";
import {
  AnnotateLocatorsProvider,
  type AnnotateSink,
  useAnnotateSink,
} from "./sink";
import { TargetWords } from "./target-words";

// Annotate (night 2, decision 5): one pointer for every artifact kind. With
// it on, a click drops a pin and a drag marks a box over the artifact's
// view, wherever it renders; each mark takes a note. The pins stay on the
// artifact while the person drafts, and the notes go to the agent together:
// they steer the answer being written, or start the next turn. What each
// mark points at is read from the view (`./locate`) and sent with it.
//
// The layer wraps the artifact's view: its button goes in the view's
// header row (the `header` it's given), its overlay over everything below.

type Header = (content: ReactNode) => ReactNode;

export interface AnnotatableProps {
  readonly artifact: Artifact | undefined;
  /** The view, given the header to frame its row with. */
  readonly children: (header: Header) => ReactNode;
  readonly header: Header;
  /** The version shown; omitted, the latest. */
  readonly versionId?: ArtifactVersionId;
  readonly versions: readonly ArtifactVersion[] | undefined;
}

/**
 * The artifact's view with Annotate over it, where the host can send the
 * notes somewhere; otherwise the view as it is.
 */
export function Annotatable({
  artifact,
  children,
  header,
  versionId,
  versions,
}: AnnotatableProps) {
  const sink = useAnnotateSink();
  const version = versionId
    ? versions?.find((each) => each.id === versionId)
    : versions?.at(-1);
  if (!(sink && artifact && version)) {
    return children(header);
  }
  return (
    <AnnotateLayer
      artifact={artifact}
      header={header}
      key={artifact.id}
      sink={sink}
      version={version}
    >
      {children}
    </AnnotateLayer>
  );
}

type SendStatus = "idle" | "sending" | "failed";

function AnnotateLayer({
  artifact,
  children,
  header,
  sink,
  version,
}: {
  readonly artifact: Artifact;
  readonly children: (header: Header) => ReactNode;
  readonly header: Header;
  readonly sink: AnnotateSink;
  readonly version: ArtifactVersion;
}) {
  const [drafts, dispatch] = useDrafts(artifact.id);
  const [active, setActive] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [status, setStatus] = useState<SendStatus>("idle");
  const layer = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const top = useHeaderBottom(layer, headerRef, active);

  const locators = useRef(new Map<Element, Locator>());
  const register = useCallback((element: Element, locator: Locator) => {
    locators.current.set(element, locator);
    return () => {
      if (locators.current.get(element) === locator) {
        locators.current.delete(element);
      }
    };
  }, []);

  const toggle = useCallback(() => {
    setActive((on) => !on);
    setOpen(null);
  }, []);
  useShortcut("artifact.annotate", toggle);

  const close = useCallback(() => {
    // A note left empty was a misclick.
    const opened = drafts.find((draft) => draft.id === open);
    if (opened && opened.note.trim() === "") {
      dispatch({ id: opened.id, type: "remove" });
    }
    setOpen(null);
  }, [dispatch, drafts, open]);

  const add = useCallback(
    (mark: AnnotationMark, area: HTMLElement) => {
      const id = crypto.randomUUID();
      dispatch({
        id,
        mark,
        type: "add",
        version: version.number,
        versionId: version.id,
      });
      setOpen(id);
      // Everything the layer draws is skipped: what's under it is asked.
      locate(
        clientBox(mark, area.getBoundingClientRect()),
        overlay.current ?? area,
        locators.current
      )
        .catch(() => null)
        .then((target) => dispatch({ id, target, type: "locate" }));
    },
    [dispatch, version.id, version.number]
  );

  const remove = useCallback(
    (id: string) => {
      dispatch({ id, type: "remove" });
      setOpen(null);
    },
    [dispatch]
  );
  const write = useCallback(
    (id: string, note: string) => dispatch({ id, note, type: "write" }),
    [dispatch]
  );
  const clear = useCallback(() => {
    dispatch({ type: "clear" });
    setOpen(null);
  }, [dispatch]);
  const done = useCallback(() => setActive(false), []);

  const notes = useMemo(() => sendable(drafts), [drafts]);
  const send = useCallback(async () => {
    if (notes.length === 0) {
      return;
    }
    setStatus("sending");
    try {
      await sink.send({
        artifactId: artifact.id,
        kind: artifact.kind,
        notes: [...notes],
        title: artifact.title.slice(0, 200),
      });
      // Handed to the chat, they wait there to be sent.
      if (sink.mode !== "chat") {
        dispatch({ type: "clear" });
      }
      setActive(false);
      setOpen(null);
      setStatus("idle");
    } catch {
      setStatus("failed");
    }
  }, [artifact, dispatch, notes, sink]);

  // Escape leaves the note, then Annotate, from anywhere inside the layer,
  // and isn't the chat's Escape (stop generating).
  const onEscape = useEffectEvent((event: globalThis.KeyboardEvent) => {
    if (event.key !== "Escape" || !(open || active)) {
      return;
    }
    event.stopPropagation();
    if (open) {
      close();
    } else {
      setActive(false);
    }
  });
  useEffect(() => {
    const root = layer.current;
    const listener = (event: globalThis.KeyboardEvent) => onEscape(event);
    root?.addEventListener("keydown", listener);
    return () => root?.removeEventListener("keydown", listener);
  }, []);

  // The host's row is the one element in `contents`: the overlay starts
  // under it.
  const annotated = useCallback(
    (content: ReactNode) => (
      <div className="contents" ref={headerRef}>
        {header(
          <>
            {content}
            <AnnotateToggle
              active={active}
              count={drafts.length}
              onToggle={toggle}
            />
          </>
        )}
      </div>
    ),
    [active, drafts.length, header, toggle]
  );

  const opened = drafts.find((draft) => draft.id === open);
  return (
    <AnnotateLocatorsProvider value={register}>
      <div className="relative flex h-full min-h-0 flex-1 flex-col" ref={layer}>
        {children(annotated)}
        {active || drafts.length > 0 ? (
          <div
            className={cn(
              "absolute inset-x-0 bottom-0 z-20",
              !active && "pointer-events-none"
            )}
            data-annotate-layer=""
            ref={overlay}
            style={{ top }}
          >
            {active ? <CaptureSurface onMark={add} /> : null}
            {drafts.map((draft, index) => (
              <Pin
                current={draft.versionId === version.id}
                draft={draft}
                key={draft.id}
                number={index + 1}
                onOpen={setOpen}
                open={draft.id === open}
              />
            ))}
            {opened ? (
              <NoteEditor
                draft={opened}
                key={opened.id}
                number={drafts.indexOf(opened) + 1}
                onClose={close}
                onRemove={remove}
                onWrite={write}
              />
            ) : null}
            <ActionBar
              active={active}
              count={drafts.length}
              mode={sink.mode}
              onClear={clear}
              onDone={done}
              onSend={send}
              ready={notes.length}
              status={status}
            />
          </div>
        ) : null}
      </div>
    </AnnotateLocatorsProvider>
  );
}

/**
 * The bottom of the view's header row, from the layer's top: the overlay
 * covers what's below it. Measured again whenever either changes size.
 */
const useHeaderBottom = (
  layer: RefObject<HTMLElement | null>,
  header: RefObject<HTMLElement | null>,
  /** Measured again on switching on, in case the row was redrawn. */
  active: boolean
): number => {
  const [top, setTop] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `active` is a trigger, not read.
  useLayoutEffect(() => {
    const root = layer.current;
    const row = header.current?.firstElementChild;
    if (!root) {
      return;
    }
    const measure = () => {
      const bottom = row
        ? row.getBoundingClientRect().bottom - root.getBoundingClientRect().top
        : 0;
      setTop(Math.max(0, bottom));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    if (row) {
      observer.observe(row);
    }
    return () => observer.disconnect();
  }, [active, header, layer]);
  return top;
};

function AnnotateToggle({
  active,
  count,
  onToggle,
}: {
  readonly active: boolean;
  readonly count: number;
  readonly onToggle: () => void;
}) {
  const { t } = useLingui();
  const label = active ? t`Stop annotating` : t`Annotate`;
  return (
    <Button
      aria-label={
        count > 0
          ? t`${label}, ${plural(count, { one: "# note", other: "# notes" })}`
          : label
      }
      aria-pressed={active}
      className="shrink-0"
      onClick={onToggle}
      size={count > 0 ? "sm" : "icon-sm"}
      title={t`Annotate (M)`}
      variant={active ? "secondary" : "ghost"}
    >
      <SquareDashedMousePointerIcon aria-hidden />
      {count > 0 ? <span className="tabular-nums">{count}</span> : null}
    </Button>
  );
}

/**
 * Where marks are made, over the whole view: a click drops a pin, a drag
 * a box. From the keyboard, the arrows move a cursor (Shift: further) and
 * Enter drops a pin there.
 */
function CaptureSurface({
  onMark,
}: {
  /** The mark, and the surface it's a fraction of. */
  readonly onMark: (mark: AnnotationMark, area: HTMLElement) => void;
}) {
  const { t } = useLingui();
  const [drag, setDrag] = useState<{
    readonly end: Point;
    readonly start: Point;
  } | null>(null);
  const [cursor, setCursor] = useState<Point>({ x: 0.5, y: 0.5 });

  const onPointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = pointerAt(event);
    setDrag({ end: start, start });
  }, []);
  const onPointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const end = pointerAt(event);
    setDrag((current) => (current ? { ...current, end } : current));
  }, []);
  const onPointerUp = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!drag) {
        return;
      }
      const area = event.currentTarget;
      const { height, width } = area.getBoundingClientRect();
      setDrag(null);
      onMark(markFrom(drag.start, pointerAt(event), { height, width }), area);
    },
    [drag, onMark]
  );
  const onPointerCancel = useCallback(() => setDrag(null), []);
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        onMark({ shape: "point", ...cursor }, event.currentTarget);
        return;
      }
      const next = moveCursor(cursor, event.key, event.shiftKey);
      if (next) {
        event.preventDefault();
        setCursor(next);
      }
    },
    [cursor, onMark]
  );

  const box = drag
    ? markFrom(drag.start, drag.end, { height: 1000, width: 1000 })
    : null;
  return (
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: a surface to point at, by pointer or by arrow keys and Enter; no native element is one.
    <div
      aria-label={t`Annotation area. Click or drag to mark part of the artifact, or use the arrow keys and Enter.`}
      className="group/surface absolute inset-0 cursor-crosshair touch-none bg-primary/5 outline-none ring-ring/50 ring-inset focus-visible:ring-2"
      onKeyDown={onKeyDown}
      onPointerCancel={onPointerCancel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      role="application"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the keyboard way to place a pin.
      tabIndex={0}
    >
      {box?.shape === "region" ? (
        <span
          aria-hidden
          className="absolute rounded-sm border-2 border-primary border-dashed bg-primary/10"
          style={boxStyle(box)}
        />
      ) : null}
      <span
        aria-hidden
        className="absolute hidden size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary group-focus-visible/surface:block"
        style={{ left: `${cursor.x * 100}%`, top: `${cursor.y * 100}%` }}
      />
    </div>
  );
}

/** Where a pointer is, as a fraction of the element listening. */
const pointerAt = (event: PointerEvent<HTMLElement>): Point =>
  fractionIn(
    { x: event.clientX, y: event.clientY },
    event.currentTarget.getBoundingClientRect()
  );

const stopPress = (event: PointerEvent) => event.stopPropagation();

const boxStyle = (mark: Extract<AnnotationMark, { shape: "region" }>) => ({
  height: `${mark.height * 100}%`,
  left: `${mark.x * 100}%`,
  top: `${mark.y * 100}%`,
  width: `${mark.width * 100}%`,
});

function Pin({
  current,
  draft,
  number,
  onOpen,
  open,
}: {
  /** Made on the version shown. */
  readonly current: boolean;
  readonly draft: DraftNote;
  readonly number: number;
  readonly onOpen: (id: string) => void;
  readonly open: boolean;
}) {
  const { t } = useLingui();
  const anchor = anchorOf(draft.mark);
  const note = draft.note.trim();
  const { id } = draft;
  const onClick = useCallback(() => onOpen(id), [id, onOpen]);
  return (
    <>
      {draft.mark.shape === "region" ? (
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute rounded-sm border-2 border-primary border-dashed bg-primary/10",
            !current && "opacity-50"
          )}
          style={boxStyle(draft.mark)}
        />
      ) : null}
      <button
        aria-expanded={open}
        aria-label={
          note ? t`Note ${number}: ${note}` : t`Note ${number}, not written yet`
        }
        className={cn(
          "pointer-events-auto absolute flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-primary font-medium text-primary-foreground text-xs shadow-md outline-none ring-offset-2 ring-offset-background focus-visible:ring-2 focus-visible:ring-ring",
          open && "ring-2 ring-ring",
          !current && "opacity-50"
        )}
        onClick={onClick}
        // A press on a pin isn't a new mark.
        onPointerDown={stopPress}
        style={{ left: `${anchor.x * 100}%`, top: `${anchor.y * 100}%` }}
        title={note || undefined}
        type="button"
      >
        {number}
      </button>
    </>
  );
}

/** The note on a mark: where it points, the words, Remove and Done. */
function NoteEditor({
  draft,
  number,
  onClose,
  onRemove,
  onWrite,
}: {
  readonly draft: DraftNote;
  readonly number: number;
  readonly onClose: () => void;
  readonly onRemove: (id: string) => void;
  readonly onWrite: (id: string, note: string) => void;
}) {
  const { t } = useLingui();
  const { id } = draft;
  const remove = useCallback(() => onRemove(id), [id, onRemove]);
  const change = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) =>
      onWrite(id, event.target.value),
    [id, onWrite]
  );
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        onClose();
      }
    },
    [onClose]
  );
  const anchor = anchorOf(draft.mark);
  const below = anchor.y < 0.6;
  return (
    <section
      aria-label={t`Note ${number}`}
      className="pointer-events-auto absolute z-30 flex w-64 flex-col gap-2 rounded-lg border border-border bg-popover p-2 text-popover-foreground shadow-md"
      onPointerDown={stopPress}
      style={{
        left: `clamp(0.5rem, calc(${anchor.x * 100}% - 8rem), calc(100% - 16.5rem))`,
        ...(below
          ? { top: `calc(${anchor.y * 100}% + 1rem)` }
          : { bottom: `calc(${(1 - anchor.y) * 100}% + 1rem)` }),
      }}
    >
      <p className="truncate text-muted-foreground text-xs">
        <Where draft={draft} />
      </p>
      <Textarea
        aria-label={t`Note`}
        autoFocus
        className="min-h-16 resize-none text-sm"
        maxLength={2000}
        onChange={change}
        onKeyDown={onKeyDown}
        placeholder={t`What should change here?`}
        value={draft.note}
      />
      <div className="flex items-center justify-between gap-2">
        <Button onClick={remove} size="xs" variant="ghost">
          <Trash2Icon aria-hidden data-icon="inline-start" />
          <Trans>Remove</Trans>
        </Button>
        <Button onClick={onClose} size="xs">
          <Trans>Done</Trans>
        </Button>
      </div>
    </section>
  );
}

/** What a note points at, in a few words. */
function Where({ draft }: { readonly draft: DraftNote }) {
  const { target } = draft;
  if (target === undefined) {
    return <Trans>Finding what's here…</Trans>;
  }
  if (target) {
    return <TargetWords target={target} />;
  }
  return draft.mark.shape === "point" ? (
    <Trans>A point on version {draft.version}</Trans>
  ) : (
    <Trans>An area on version {draft.version}</Trans>
  );
}

function SendLabel({ mode }: { readonly mode: AnnotateSink["mode"] }) {
  switch (mode) {
    case "steer":
      return <Trans>Steer with notes</Trans>;
    case "send":
      return <Trans>Send notes</Trans>;
    case "chat":
      return <Trans>Send in chat</Trans>;
    default:
      return mode satisfies never;
  }
}

/** Floats at the bottom of the view while there are notes, or Annotate is on. */
function ActionBar({
  active,
  count,
  mode,
  onClear,
  onDone,
  onSend,
  ready,
  status,
}: {
  readonly active: boolean;
  readonly count: number;
  readonly mode: AnnotateSink["mode"];
  readonly onClear: () => void;
  readonly onDone: () => void;
  readonly onSend: () => void;
  /** Notes written, so ready to send. */
  readonly ready: number;
  readonly status: SendStatus;
}) {
  const { t } = useLingui();
  return (
    <div
      aria-label={t`Annotations`}
      className="pointer-events-auto absolute inset-x-0 bottom-3 z-30 mx-auto flex w-fit max-w-[calc(100%-1.5rem)] flex-wrap items-center justify-center gap-1 rounded-full border border-border bg-popover px-3 py-1 text-popover-foreground text-sm shadow-md"
      onPointerDown={stopPress}
      role="toolbar"
    >
      <span aria-live="polite" className="px-1 text-muted-foreground">
        {count === 0
          ? t`Click or drag to add a note`
          : t`${plural(count, { one: "# note", other: "# notes" })}`}
      </span>
      {status === "failed" ? (
        <span className="px-1 text-destructive" role="alert">
          <Trans>Couldn't send. Try again.</Trans>
        </span>
      ) : null}
      {count > 0 ? (
        <Button onClick={onClear} size="xs" variant="ghost">
          <Trans>Clear</Trans>
        </Button>
      ) : null}
      {active ? (
        <Button onClick={onDone} size="xs" variant="ghost">
          <Trans>Done</Trans>
        </Button>
      ) : null}
      {ready > 0 ? (
        <Button disabled={status === "sending"} onClick={onSend} size="xs">
          <SendIcon aria-hidden data-icon="inline-start" />
          <SendLabel mode={mode} />
        </Button>
      ) : null}
    </div>
  );
}
