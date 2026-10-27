"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import {
  type Presentation,
  presentationContentSchema,
  presentationText,
} from "@workspace/artifacts-kit/kinds/presentation/content";
import {
  applyDeckAction,
  type DeckAction,
} from "@workspace/artifacts-kit/kinds/presentation/deck-actions";
import {
  editFor,
  type SlideChange,
  type SlideTarget,
} from "@workspace/artifacts-kit/kinds/presentation/edit-target";
import type { QueryUtils } from "@workspace/client/api";
import type {
  Artifact,
  ArtifactListItem,
  ArtifactVersion,
} from "@workspace/contract/schemas/files";
import { CircleAlertIcon } from "@workspace/icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ArtifactSelection } from "../artifact-view";
import { EditorShell, EditorToolbar } from "../editor/editor-shell";
import { InstructionForm, useAskChat } from "../editor/instruction";
import { NotesDrawer } from "../editor/notes-drawer";
import { OlderVersion, SaveStatus } from "../editor/save-status";
import type { StyleChange } from "../editor/style";
import { useEditorHistory, useUndoKeys } from "../editor/use-history";
import {
  type SaveVersion,
  useSaveVersion,
  useVersionSave,
} from "../editor/use-version-save";
import {
  DeckActions,
  DeckNotices,
  DeckStage,
  type PickSource,
  PresentationPreview,
  useDeck,
} from "../presentation-preview";
import type { PickedElement } from "../runtime-protocol";
import { judgePick, nextPick, type Picked } from "./pick";
import { SlideInspector, SlideInspectorPlaceholder } from "./slide-inspector";
import { SlideRail } from "./slide-rail";

// A presentation (164) as the slides editor (n2), built on the shared
// artifact editor (`../editor`): the sorter at the start, the slide with
// its elements to pick, the inspector for what's picked at the end, and
// "Change this slide" and the slide's speaker notes under it. Every change is
// the deck's next value, kept in the undo history and saved as a version
// after a pause; the agent's own edits arrive as versions and join the
// history too, so Undo takes one back. Read only for viewers and on an
// older version.

export interface PresentationEditorProps {
  readonly api?: QueryUtils;
  readonly artifact: Artifact;
  readonly info?: ArtifactListItem;
  readonly onSelect: (selection: ArtifactSelection) => void;
  /** Whether the host shows a version it was asked for, not just the latest. */
  readonly pinned: boolean;
  readonly runtimeOrigin: string | null;
  readonly version: ArtifactVersion;
  /** Oldest first. */
  readonly versions: readonly ArtifactVersion[];
}

// The edit engine (a TSX parser) loads on the first edit, not with the chat.
let engine: Promise<
  typeof import("@workspace/artifacts-kit/kinds/presentation/visual-edits")
> | null = null;
const loadEngine = () => {
  engine ??= import(
    "@workspace/artifacts-kit/kinds/presentation/visual-edits"
  ).catch((error: unknown) => {
    // A failed load (offline, a new deploy) is tried again on the next edit.
    engine = null;
    throw error;
  });
  return engine;
};

/**
 * How long editing pauses before the deck is saved as a version: one
 * version per burst of editing, not one per change. What's waiting is
 * saved before asking the agent, on leaving the editor, and the page warns
 * before closing with it unsaved.
 */
export const SAVE_IDLE_MS = 60_000;

/** The longest a run of edits goes unsaved, however steady. */
export const SAVE_MAX_MS = 5 * 60_000;

const parseDeck = (content: string): Presentation | null => {
  const parsed = presentationContentSchema.safeParse(content);
  return parsed.success ? parsed.data : null;
};

export function PresentationEditor(props: PresentationEditorProps) {
  const { api, artifact, runtimeOrigin, version, versions } = props;
  const latest = versions.at(-1) ?? version;
  const deck = useMemo(() => parseDeck(version.content), [version.content]);
  // Without the API, the runtime or a deck to edit, it's the plain preview.
  if (!(api && runtimeOrigin && deck)) {
    return (
      <PresentationPreview
        content={version.content}
        runtimeOrigin={runtimeOrigin}
        title={artifact.title}
      />
    );
  }
  const isLatest = version.id === latest.id;
  return (
    <ConnectedEditor
      {...props}
      api={api}
      // A version picked from the header is its own (read-only) view; the
      // latest stays one editor as saves move it on.
      key={isLatest ? "latest" : version.id}
      latest={latest}
      runtimeOrigin={runtimeOrigin}
    />
  );
}

function ConnectedEditor({
  api,
  artifact,
  info,
  latest,
  ...rest
}: PresentationEditorProps & {
  readonly api: QueryUtils;
  readonly latest: ArtifactVersion;
  readonly runtimeOrigin: string;
}) {
  const detail = useQuery({
    ...api.artifacts.detail.queryOptions({ input: { id: artifact.id } }),
    enabled: info === undefined,
  });
  const access = (info ?? detail.data?.artifact)?.access;
  const save = useSaveVersion(api, artifact.id);
  const ask = useAskChat(api, artifact.conversationId);
  return (
    <DeckEditor
      {...rest}
      artifact={artifact}
      ask={ask}
      latest={latest}
      mayEdit={access === "owner" || access === "editor"}
      save={save}
    />
  );
}

type Ask = ReturnType<typeof useAskChat>;

const targetKey = (target: SlideTarget): string =>
  [target.slide, target.line, target.column, target.part, target.prop].join(
    ":"
  );

function DeckEditor({
  artifact,
  ask,
  latest,
  mayEdit,
  onSelect,
  pinned,
  runtimeOrigin,
  save,
  version,
}: {
  readonly artifact: Artifact;
  readonly ask: Ask;
  readonly latest: ArtifactVersion;
  /** Owner or editor of the artifact. */
  readonly mayEdit: boolean;
  readonly onSelect: (selection: ArtifactSelection) => void;
  readonly pinned: boolean;
  readonly runtimeOrigin: string;
  readonly save: SaveVersion;
  readonly version: ArtifactVersion;
}) {
  const { t } = useLingui();
  const isLatest = version.id === latest.id;
  const canEdit = mayEdit && isLatest;
  const [content, setContent] = useState(version.content);
  // The deck as last changed, ahead of the render that shows it: an edit
  // that waited for the engine applies to this, not to what it first saw.
  const latestContent = useRef(content);
  const deck = useMemo(() => parseDeck(content), [content]);
  const history = useEditorHistory(version.content);
  const versionSave = useVersionSave({
    baseVersionId: latest.id,
    delay: SAVE_IDLE_MS,
    save,
  });
  const { change, saved: isMine, state } = versionSave;
  const [problem, setProblem] = useState<string | null>(null);
  // When the edits waiting to be saved began.
  const burstStart = useRef<number | null>(null);
  const { flush } = versionSave;
  const flushSoon = useCallback(() => {
    flush().catch(() => undefined);
  }, [flush]);
  useEffect(() => {
    if (state === "saved") {
      burstStart.current = null;
    }
  }, [state]);

  const slides = useMemo(
    () => deck?.slides.map((slide) => slide.id) ?? [],
    [deck]
  );
  const [focus, setFocus] = useState<string | undefined>(slides[0]);
  const focusRef = useRef(focus);
  focusRef.current = focus;
  const current = deck?.slides.find((slide) => slide.id === focus);
  const index = current && deck ? deck.slides.indexOf(current) : -1;
  const [picked, setPicked] = useState<Picked | null>(null);
  // Moves on whenever the deck's source changes under the editor (the
  // agent's version, undo, redo, Load theirs): a pick from before can name
  // an element that's no longer where it was, so it's dropped.
  const epochRef = useRef(0);
  const [epoch, setEpoch] = useState(0);
  const moveEpoch = useCallback(() => {
    epochRef.current += 1;
    setEpoch(epochRef.current);
    setPicked(null);
  }, []);
  const onPicked = useCallback(
    (element: PickedElement | null, from: PickSource) =>
      setPicked((now) =>
        nextPick(
          now,
          element,
          judgePick({
            current: now,
            epoch: epochRef.current,
            focus: focusRef.current,
            from,
            incoming: element,
          }),
          from.epoch
        )
      ),
    []
  );

  // A slide that's gone (deleted, undone) gives way to the first.
  useEffect(() => {
    if (!current && slides[0]) {
      setFocus(slides[0]);
    }
  }, [current, slides]);

  /** Shows and keeps `next`, the deck's whole text: one step of history. */
  const keep = useCallback(
    (next: string, key?: string) => {
      if (next === latestContent.current) {
        return;
      }
      latestContent.current = next;
      setProblem(null);
      setContent(next);
      history.record(next, key);
      change(next);
      // A long run of edits still saves every few minutes.
      const now = Date.now();
      burstStart.current ??= now;
      if (now - burstStart.current >= SAVE_MAX_MS) {
        burstStart.current = null;
        flushSoon();
      }
      // Pinned to the version being edited, the host would hold on to it
      // once this saves a newer one.
      if (pinned) {
        onSelect({ artifactId: artifact.id });
      }
    },
    [artifact.id, change, flushSoon, history, onSelect, pinned]
  );

  // A version made elsewhere (the agent, another editor) shows at once
  // when nothing here waits to be saved, as a step Undo can take back.
  const latestShown = useRef(latest.id);
  useEffect(() => {
    if (latestShown.current === latest.id || !isLatest) {
      return;
    }
    latestShown.current = latest.id;
    if (!isMine(latest.id) && state === "saved") {
      latestContent.current = latest.content;
      moveEpoch();
      setContent(latest.content);
      history.record(latest.content);
    }
  }, [history, isLatest, isMine, latest, moveEpoch, state]);

  const act = useCallback(
    (action: DeckAction, key?: string) => {
      if (!(canEdit && deck)) {
        return;
      }
      const result = applyDeckAction(deck, action);
      if (!result.ok) {
        setProblem(result.error);
        return;
      }
      keep(presentationText(result.value.deck), key);
      if (result.value.select !== focus) {
        setFocus(result.value.select);
        setPicked(null);
      }
    },
    [canEdit, deck, focus, keep]
  );

  const edit = useCallback(
    async (target: SlideTarget, slideChange: SlideChange, key: string) => {
      if (!canEdit) {
        return false;
      }
      const engineModule = await loadEngine().catch(() => null);
      const base = parseDeck(latestContent.current);
      if (!(engineModule && base)) {
        setProblem(t`the editor couldn't load. Try again.`);
        return false;
      }
      const result = engineModule.applyDeckVisualEdits(base, [
        editFor(target, slideChange),
      ]);
      if (!result.ok) {
        setProblem(result.error.join("\n"));
        return false;
      }
      keep(presentationText(result.value), key);
      return true;
    },
    [canEdit, keep, t]
  );

  const step = useCallback(
    (to: string | null) => {
      if (to === null) {
        return;
      }
      latestContent.current = to;
      moveEpoch();
      setProblem(null);
      setContent(to);
      change(to);
    },
    [change, moveEpoch]
  );
  const undo = useCallback(() => {
    if (canEdit) {
      step(history.undo());
    }
  }, [canEdit, history, step]);
  const redo = useCallback(() => {
    if (canEdit) {
      step(history.redo());
    }
  }, [canEdit, history, step]);
  const onKeyDown = useUndoKeys({ onRedo: redo, onUndo: undo });

  const deckView = useDeck({
    content,
    editing: {
      epoch,
      focus,
      inspect: true,
      onPicked,
      selection: picked?.element.target ?? null,
    },
    runtimeOrigin,
    title: artifact.title,
  });
  const { select } = deckView;

  const choose = useCallback(
    (slide: string) => {
      setFocus(slide);
      setPicked(null);
      select(slide, null);
    },
    [select]
  );
  const unpick = useCallback(() => {
    setPicked(null);
    if (focus) {
      select(focus, null);
    }
  }, [focus, select]);

  /** The pick, if it still belongs to the source on screen. */
  const live = useCallback((): Picked | null => {
    if (picked && picked.epoch !== epochRef.current) {
      setPicked(null);
      setProblem(t`the slide changed. Pick the element again.`);
      return null;
    }
    return picked;
  }, [picked, t]);

  const onStyle = useCallback(
    (styleChange: StyleChange) => {
      const now = live();
      if (now) {
        const { target } = now.element;
        edit(
          target,
          { key: styleChange.key, kind: "style", value: styleChange.value },
          `style:${styleChange.key}:${targetKey(target)}`
        ).catch(() => undefined);
      }
    },
    [edit, live]
  );
  const onWords = useCallback(
    (text: string) => {
      const now = live();
      if (!now || now.element.text === null) {
        return;
      }
      const { target, text: previous } = now.element;
      // The next keystroke's "before" is this one's "after", before the
      // frame has drawn it.
      setPicked({ ...now, element: { ...now.element, text } });
      edit(
        target,
        { kind: "text", previous, value: text },
        `text:${targetKey(target)}`
      ).catch(() => undefined);
    },
    [edit, live]
  );

  const onAdd = useCallback(
    () => act({ after: focus ?? null, type: "add" }),
    [act, focus]
  );
  const onDelete = useCallback(
    (slide: string) => act({ slide, type: "delete" }),
    [act]
  );
  const onDuplicate = useCallback(
    (slide: string) => act({ slide, type: "duplicate" }),
    [act]
  );
  const onMove = useCallback(
    (slide: string, to: number) => act({ index: to, slide, type: "move" }),
    [act]
  );
  const onNotes = useCallback(
    (notes: string) => {
      if (focus) {
        act({ notes, slide: focus, type: "notes" }, `notes:${focus}`);
      }
    },
    [act, focus]
  );

  // Edits wait up to a minute: leaving the tab or the page saves them now
  // (as an open file does), and closing with them unsaved asks first.
  useEffect(() => {
    if (state === "saved") {
      return;
    }
    const saveNow = () => {
      flush().catch(() => undefined);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        saveNow();
      }
    };
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("pagehide", saveNow);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("pagehide", saveNow);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("beforeunload", warn);
    };
  }, [flush, state]);
  const artifactTitle = artifact.title;
  const changeSlide = useCallback(
    async (instruction: string) => {
      if (!current) {
        return;
      }
      // The agent edits the latest version: what's here goes first, or
      // the agent's edit would land on top of a deck without it.
      if (!(await flush())) {
        setProblem(
          t`your changes aren't saved yet, so the agent wasn't asked. Save them, then try again.`
        );
        return;
      }
      const number = index + 1;
      const slide = current.id;
      const title = artifactTitle;
      await ask.send(
        t`Change slide ${number} ("${slide}") of the presentation "${title}": ${instruction}

Edit only that slide, with update_artifact's update_slide.`
      );
    },
    [artifactTitle, ask, current, flush, index, t]
  );

  const loadLatest = useCallback(() => {
    latestContent.current = latest.content;
    moveEpoch();
    setContent(latest.content);
    history.reset(latest.content);
    versionSave.reset(latest.id);
  }, [history, latest, moveEpoch, versionSave]);
  const keepMine = useCallback(
    () => versionSave.keepMine(latest.id),
    [latest.id, versionSave]
  );
  const retry = useCallback(() => {
    flush().catch(() => undefined);
  }, [flush]);
  const openLatest = useCallback(
    () => onSelect({ artifactId: artifact.id }),
    [artifact.id, onSelect]
  );
  const restore = useCallback(() => {
    save({ baseVersionId: latest.id, content: version.content })
      .then(() => onSelect({ artifactId: artifact.id }))
      .catch(() => undefined);
  }, [artifact.id, latest.id, onSelect, save, version.content]);

  if (!deck) {
    return (
      <PresentationPreview
        content={content}
        runtimeOrigin={runtimeOrigin}
        title={artifact.title}
      />
    );
  }

  return (
    <EditorShell
      canvas={
        <>
          <DeckNotices deck={deckView} />
          {problem ? (
            <p
              className="flex items-start gap-2 border-b bg-destructive/5 px-3 py-2 text-xs"
              role="alert"
            >
              <CircleAlertIcon
                aria-hidden
                className="mt-0.5 size-3.5 shrink-0 text-destructive"
              />
              <span className="min-w-0 whitespace-pre-wrap">
                <Trans>That change wasn't made: {problem}</Trans>
              </span>
            </p>
          ) : null}
          <DeckStage deck={deckView} />
        </>
      }
      covered={deckView.presenting}
      drawer={
        current && canEdit && ask.available ? (
          <div className="shrink-0 border-t px-3 py-2">
            <InstructionForm
              disabled={false}
              label={t`Change this slide`}
              onSubmit={changeSlide}
              placeholder={t`Change this slide… (the agent edits it)`}
              state={ask.state}
            />
          </div>
        ) : null
      }
      inspector={
        picked ? (
          <SlideInspector
            canEdit={canEdit}
            element={picked.element}
            onClose={unpick}
            onStyle={onStyle}
            onText={onWords}
          />
        ) : null
      }
      inspectorPlaceholder={<SlideInspectorPlaceholder canEdit={canEdit} />}
      notes={
        current ? (
          <NotesDrawer
            key={current.id}
            label={t`Speaker notes`}
            meta={
              <Trans>
                Slide {index + 1} of {deck.slides.length}
              </Trans>
            }
            onCommit={onNotes}
            placeholder={t`What to say on this slide`}
            readOnly={!canEdit}
            value={current.notes ?? ""}
          />
        ) : null
      }
      onKeyDown={onKeyDown}
      rail={
        <SlideRail
          canEdit={canEdit}
          content={content}
          onAdd={onAdd}
          onDelete={onDelete}
          onDuplicate={onDuplicate}
          onMove={onMove}
          onSelect={choose}
          runtimeOrigin={runtimeOrigin}
          selected={focus ?? null}
          slides={slides}
          title={artifact.title}
        />
      }
      toolbar={
        <EditorToolbar
          canRedo={canEdit && history.canRedo}
          canUndo={canEdit && history.canUndo}
          onRedo={redo}
          onUndo={undo}
          status={
            isLatest ? (
              <SaveStatus
                canEdit={mayEdit}
                onKeepMine={keepMine}
                onLoadLatest={loadLatest}
                onRetry={retry}
                state={state}
              />
            ) : (
              <OlderVersion
                canRestore={mayEdit}
                number={version.number}
                onLatest={openLatest}
                onRestore={restore}
              />
            )
          }
        >
          <DeckActions deck={deckView} />
        </EditorToolbar>
      }
    />
  );
}
