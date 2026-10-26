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
  PresentationPreview,
  useDeck,
} from "../presentation-preview";
import type { PickedElement } from "../runtime-protocol";
import { SlideInspector } from "./slide-inspector";
import { SlideRail } from "./slide-rail";

// A presentation (164) as the slides editor (n2), built on the shared
// artifact editor (`../editor`): the sorter beside the slide, the slide
// with its elements to pick, the inspector for what's picked, and the
// slide's speaker notes and "Change this slide" under it. Every change is
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
  engine ??= import("@workspace/artifacts-kit/kinds/presentation/visual-edits");
  return engine;
};

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
  const deck = useMemo(() => parseDeck(content), [content]);
  const history = useEditorHistory(version.content);
  const versionSave = useVersionSave({ baseVersionId: latest.id, save });
  const { change, saved: isMine, state } = versionSave;
  const [problem, setProblem] = useState<string | null>(null);

  const slides = useMemo(
    () => deck?.slides.map((slide) => slide.id) ?? [],
    [deck]
  );
  const [focus, setFocus] = useState<string | undefined>(slides[0]);
  const current = deck?.slides.find((slide) => slide.id === focus);
  const index = current && deck ? deck.slides.indexOf(current) : -1;
  const [picked, setPicked] = useState<PickedElement | null>(null);

  // A slide that's gone (deleted, undone) gives way to the first.
  useEffect(() => {
    if (!current && slides[0]) {
      setFocus(slides[0]);
    }
  }, [current, slides]);

  /** Shows and keeps `next`, the deck's whole text: one step of history. */
  const keep = useCallback(
    (next: string, key?: string) => {
      if (next === content) {
        return;
      }
      setProblem(null);
      setContent(next);
      history.record(next, key);
      change(next);
      // Pinned to the version being edited, the host would hold on to it
      // once this saves a newer one.
      if (pinned) {
        onSelect({ artifactId: artifact.id });
      }
    },
    [artifact.id, change, content, history, onSelect, pinned]
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
      setContent(latest.content);
      history.record(latest.content);
    }
  }, [history, isLatest, isMine, latest, state]);

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
      if (!(canEdit && deck)) {
        return false;
      }
      const { applyDeckVisualEdits } = await loadEngine();
      const result = applyDeckVisualEdits(deck, [editFor(target, slideChange)]);
      if (!result.ok) {
        setProblem(result.error.join("\n"));
        return false;
      }
      keep(presentationText(result.value), key);
      return true;
    },
    [canEdit, deck, keep]
  );

  const step = useCallback(
    (to: string | null) => {
      if (to === null || !canEdit) {
        return;
      }
      setProblem(null);
      setContent(to);
      change(to);
    },
    [canEdit, change]
  );
  const undo = useCallback(() => step(history.undo()), [history, step]);
  const redo = useCallback(() => step(history.redo()), [history, step]);
  const onKeyDown = useUndoKeys({ onRedo: redo, onUndo: undo });

  const onText = useCallback(
    (edited: {
      readonly previous: string;
      readonly target: SlideTarget;
      readonly text: string;
    }) => {
      edit(
        edited.target,
        { kind: "text", previous: edited.previous, value: edited.text },
        `text:${targetKey(edited.target)}`
      ).catch(() => undefined);
    },
    [edit]
  );
  const onCommand = useCallback(
    (command: "redo" | "undo") => (command === "undo" ? undo() : redo()),
    [redo, undo]
  );

  const deckView = useDeck({
    content,
    editing: {
      focus,
      inspect: true,
      onCommand,
      onPicked: setPicked,
      onText,
      selection: picked?.target ?? null,
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

  const onStyle = useCallback(
    (styleChange: StyleChange) => {
      if (picked) {
        edit(
          picked.target,
          { key: styleChange.key, kind: "style", value: styleChange.value },
          `style:${styleChange.key}:${targetKey(picked.target)}`
        );
      }
    },
    [edit, picked]
  );
  const onWords = useCallback(
    (text: string) => {
      if (!picked || picked.text === null) {
        return;
      }
      // The next keystroke's "before" is this one's "after", before the
      // frame has drawn it.
      setPicked({ ...picked, text });
      edit(
        picked.target,
        { kind: "text", previous: picked.text, value: text },
        `text:${targetKey(picked.target)}`
      ).catch(() => undefined);
    },
    [edit, picked]
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

  const { flush } = versionSave;
  const artifactTitle = artifact.title;
  const changeSlide = useCallback(
    async (instruction: string) => {
      if (!current) {
        return;
      }
      // The agent edits the latest version: what's here goes first.
      await flush();
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
    setContent(latest.content);
    history.reset(latest.content);
    versionSave.reset(latest.id);
  }, [history, latest, versionSave]);
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
      drawer={
        current ? (
          <>
            {canEdit && ask.available ? (
              <div className="shrink-0 border-t px-3 py-2">
                <InstructionForm
                  disabled={false}
                  label={t`Change this slide`}
                  onSubmit={changeSlide}
                  placeholder={t`Change this slide… (the agent edits it)`}
                  state={ask.state}
                />
              </div>
            ) : null}
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
          </>
        ) : null
      }
      inspector={
        picked ? (
          <SlideInspector
            canEdit={canEdit}
            element={picked}
            onClose={unpick}
            onStyle={onStyle}
            onText={onWords}
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
