"use client";

import type { ApiClient } from "@workspace/client/api";
import { followConversationEvents } from "@workspace/client/conversation-events";
import type { ConversationId } from "@workspace/contract/schemas/common";
import {
  type ConversationEvent,
  TYPING_TTL_MS,
} from "@workspace/contract/schemas/conversations";
import type { UserSummary } from "@workspace/contract/schemas/tenancy";
import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";

// A chat other people have open too (D25): who's here, who's typing, and
// the cues to catch up when someone else sends a message or a run starts.

interface Typist {
  readonly until: number;
  readonly user: UserSummary;
}

export interface LiveState {
  readonly present: readonly UserSummary[];
  readonly typing: readonly Typist[];
}

export type LiveAction =
  | {
      readonly event: ConversationEvent;
      readonly now: number;
      readonly type: "event";
    }
  | { readonly now: number; readonly type: "tick" }
  | { readonly type: "reset" };

export const NOBODY: LiveState = { present: [], typing: [] };

/** Presence and typing after one event or a clock tick. Pure. */
export const liveReducer = (
  state: LiveState,
  action: LiveAction
): LiveState => {
  switch (action.type) {
    case "reset":
      return NOBODY;
    case "tick":
      return state.typing.every(({ until }) => until > action.now)
        ? state
        : {
            ...state,
            typing: state.typing.filter(({ until }) => until > action.now),
          };
    case "event": {
      const { event, now } = action;
      switch (event.type) {
        case "presence":
          return { ...state, present: event.users };
        case "typing":
          return {
            ...state,
            typing: [
              ...state.typing.filter(({ user }) => user.id !== event.user.id),
              { until: now + TYPING_TTL_MS, user: event.user },
            ],
          };
        case "message":
          // A sent message ends its author's typing.
          return state.typing.some(({ user }) => user.id === event.authorId)
            ? {
                ...state,
                typing: state.typing.filter(
                  ({ user }) => user.id !== event.authorId
                ),
              }
            : state;
        case "run":
          return state;
        default:
          return event satisfies never;
      }
    }
    default:
      return action satisfies never;
  }
};

/** How often a person still typing says so again; under `TYPING_TTL_MS`. */
export const TYPING_SEND_MS = 2000;

export interface LiveConversation {
  /** Call on every keystroke in the composer; sends at most every `TYPING_SEND_MS`. */
  readonly onTyping: () => void;
  /** Everyone else with the chat open. */
  readonly others: readonly UserSummary[];
  /** Everyone else writing a message right now. */
  readonly typing: readonly UserSummary[];
}

export const useLiveConversation = ({
  client,
  conversationId,
  meId,
  onCatchUp,
  onRun,
}: {
  readonly client: Pick<ApiClient, "conversations">;
  readonly conversationId: ConversationId | null;
  readonly meId: string;
  /** Someone else sent a message, or the stream came back after a drop: refetch. */
  readonly onCatchUp: () => void;
  readonly onRun: (event: Extract<ConversationEvent, { type: "run" }>) => void;
}): LiveConversation => {
  const [state, dispatch] = useReducer(liveReducer, NOBODY);
  const latest = useRef({ onCatchUp, onRun });
  useEffect(() => {
    latest.current = { onCatchUp, onRun };
  });

  useEffect(() => {
    dispatch({ type: "reset" });
    if (!conversationId) {
      return;
    }
    const controller = new AbortController();
    followConversationEvents(conversationId, {
      onEvent: (event) => {
        dispatch({ event, now: Date.now(), type: "event" });
        if (event.type === "message" && event.authorId !== meId) {
          latest.current.onCatchUp();
        } else if (event.type === "run") {
          latest.current.onRun(event);
        }
      },
      onOpen: (reconnected) => {
        if (reconnected) {
          latest.current.onCatchUp();
        }
      },
      signal: controller.signal,
    });
    return () => controller.abort();
  }, [conversationId, meId]);

  const earliest = Math.min(...state.typing.map(({ until }) => until));
  useEffect(() => {
    if (!Number.isFinite(earliest)) {
      return;
    }
    const timer = setTimeout(
      () => dispatch({ now: Math.max(Date.now(), earliest), type: "tick" }),
      Math.max(0, earliest - Date.now())
    );
    return () => clearTimeout(timer);
  }, [earliest]);

  const lastSent = useRef(0);
  const onTyping = useCallback(() => {
    const now = Date.now();
    if (!conversationId || now - lastSent.current < TYPING_SEND_MS) {
      return;
    }
    lastSent.current = now;
    // A viewer can't prompt, so the server refuses; nothing to show for it.
    client.conversations.typing({ id: conversationId }).catch(() => undefined);
  }, [client, conversationId]);

  const others = useMemo(
    () => state.present.filter((user) => user.id !== meId),
    [meId, state.present]
  );
  const typing = useMemo(
    () =>
      state.typing.map(({ user }) => user).filter((user) => user.id !== meId),
    [meId, state.typing]
  );
  return { onTyping, others, typing };
};
