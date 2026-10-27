"use client";

import type {
  ConversationId,
  UserId,
} from "@workspace/contract/schemas/common";
import type { Artifact } from "@workspace/contract/schemas/files";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { z } from "zod";

import type { WorkspaceSelection } from "../model/workspace";
import { readStored, writeStored } from "../workspace/stored";
import type { ChatTask } from "./chat-tasks";
import { OutputsButton, OutputsCard, type ToggleVia } from "./outputs-card";
import {
  collapseOutputs,
  initialOutputs,
  leaveChat,
  outputsShown,
  toggleOutputs,
} from "./outputs-state";

export const OUTPUTS_STORAGE_KEY = "chat-ui:outputs-card";
/** Open until someone collapses it, as ChatGPT's is. */
const PINNED_BY_DEFAULT = true;

// Anything else stored (an old or hand-edited value) reads as unset.
const storedSchema = z.enum(["open", "closed"]).catch("open");

const readPinned = (key: string): boolean | null => {
  const stored = readStored(key);
  return stored === null ? null : storedSchema.parse(stored) === "open";
};

const writePinned = (key: string, pinned: boolean): void =>
  writeStored(key, pinned ? "open" : "closed");

const FOCUSABLE = "button:not([disabled])";

/**
 * A turn on screen gets the focus, so the keyboard carries on from it; a
 * queued one is in the composer's queue, not the transcript.
 */
const showTurn = (task: ChatTask) => {
  const target =
    document.querySelector<HTMLElement>(
      `[data-message-id="${CSS.escape(task.messageId)}"]`
    ) ??
    document.querySelector<HTMLElement>(
      `[data-run-id="${CSS.escape(task.runId)}"]`
    );
  if (!target) {
    return;
  }
  target.scrollIntoView({ block: "nearest" });
  if (!target.hasAttribute("tabindex")) {
    target.setAttribute("tabindex", "-1");
  }
  target.focus({ preventScroll: true });
};

/**
 * The outputs card and its header button: the button, A and the palette
 * toggle it (each new `request` from the palette once), a pick opens that
 * artifact in the panel, and whether it's open is remembered per person.
 */
export const useOutputsCard = ({
  artifacts,
  chatId,
  hint,
  owner,
  request,
  select,
  shown: panelShows,
  tasks,
}: {
  readonly artifacts: readonly Artifact[];
  readonly chatId: ConversationId | null;
  /** The shortcut, for the button's tooltip. */
  readonly hint?: ReactNode;
  /** Whose choice it is: the card's open state is remembered per person. */
  readonly owner?: UserId;
  readonly request: number;
  readonly select: (selection: WorkspaceSelection) => void;
  /** What the panel shows when it's on the artifacts, else `null`. */
  readonly shown: WorkspaceSelection | null;
  readonly tasks: readonly ChatTask[];
}) => {
  const id = useId();
  const key = owner ? `${OUTPUTS_STORAGE_KEY}:${owner}` : OUTPUTS_STORAGE_KEY;
  const [state, setState] = useState(() => initialOutputs(PINNED_BY_DEFAULT));
  const [restored, setRestored] = useState<string | null>(null);
  const [roomy, setRoomy] = useState(false);
  const [instant, setInstant] = useState(false);
  const [focusIn, setFocusIn] = useState(0);
  const button = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLElement>(null);

  // Read after mount, so server and client render the same first.
  useEffect(() => {
    const stored = readPinned(key);
    setState((was) => ({
      ...was,
      pinned: stored ?? PINNED_BY_DEFAULT,
    }));
    setRestored(key);
  }, [key]);
  useEffect(() => {
    if (restored === key) {
      writePinned(key, state.pinned);
    }
  }, [key, restored, state.pinned]);

  const [chat, setChat] = useState(chatId);
  if (chat !== chatId) {
    setChat(chatId);
    setState(leaveChat);
  }

  const filled = artifacts.length > 0 || tasks.length > 0;
  const room = useMemo(() => ({ filled, roomy }), [filled, roomy]);
  const shown = outputsShown(state, room);

  const toggle = useCallback(
    (via: ToggleVia) => {
      setInstant(via === "keyboard");
      if (shown && card.current?.contains(document.activeElement)) {
        button.current?.focus();
      }
      if (!shown && via === "keyboard") {
        setFocusIn((count) => count + 1);
      }
      setState((was) => toggleOutputs(was, room));
    },
    [room, shown]
  );
  const collapse = useCallback(
    (via: ToggleVia) => {
      setInstant(via === "keyboard");
      if (card.current?.contains(document.activeElement)) {
        button.current?.focus();
      }
      setState((was) => collapseOutputs(was, { roomy }));
    },
    [roomy]
  );
  const dismiss = useCallback(() => collapse("pointer"), [collapse]);

  // A keyboard opening puts the focus in the card, on its first row.
  useEffect(() => {
    if (focusIn > 0) {
      card.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    }
  }, [focusIn]);

  const [paletteAsk, setPaletteAsk] = useState(request);
  if (paletteAsk !== request) {
    setPaletteAsk(request);
    setInstant(true);
    if (!shown) {
      setFocusIn((count) => count + 1);
    }
    setState((was) => toggleOutputs(was, room));
  }

  // A pick ends a peek; a pinned card stays. Focus left in the hidden card
  // goes back to the button (a task's turn then takes it, if it's shown).
  const endPeek = useCallback(() => {
    if (!roomy) {
      if (card.current?.contains(document.activeElement)) {
        button.current?.focus();
      }
      setInstant(false);
      setState((was) => collapseOutputs(was, { roomy }));
    }
  }, [roomy]);
  const pick = useCallback(
    (artifact: Artifact) => {
      select({ artifactId: artifact.id, kind: "artifact" });
      endPeek();
    },
    [endPeek, select]
  );
  const showTask = useCallback(
    (task: ChatTask) => {
      endPeek();
      showTurn(task);
    },
    [endPeek]
  );

  const showing =
    panelShows?.kind === "artifact"
      ? (panelShows.artifactId ?? artifacts[0]?.id ?? null)
      : null;
  const busy = tasks.some(
    (task) => task.status === "running" || task.status === "waiting"
  );
  return {
    button: (
      <OutputsButton
        busy={busy}
        controls={id}
        count={artifacts.length}
        hint={hint}
        onToggle={toggle}
        ref={button}
        shown={shown}
      />
    ),
    card: (
      <OutputsCard
        artifacts={artifacts}
        cardRef={card}
        current={showing}
        id={id}
        instant={instant}
        onCollapse={collapse}
        onDismiss={roomy ? undefined : dismiss}
        onPick={pick}
        onRoomy={setRoomy}
        onShowTask={showTask}
        shown={shown}
        tasks={tasks}
      />
    ),
    toggle,
  };
};
