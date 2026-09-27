"use client";

import type { FileId, MessageId } from "@workspace/contract/schemas/common";
import type { setFeedbackInputSchema } from "@workspace/contract/schemas/feedback";
import type { ApprovalDecision } from "@workspace/contract/schemas/message-parts";
import type { Message } from "@workspace/contract/schemas/messages";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from "react";
import type { z } from "zod";

import type { ArtifactRefPart, MemoryUpdate } from "../model/parts";

export type FeedbackInput = z.input<typeof setFeedbackInputSchema>;

/**
 * Everything a message can ask the host to do. All optional: a read-only
 * view (a shared link, a viewer's seat) leaves the matching controls out.
 */
export interface ConversationActions {
  /** Where an uploaded file's bytes are served, for images and links. */
  readonly fileUrl?: (fileId: FileId) => string;
  readonly onClearFeedback?: (messageId: MessageId) => void;
  /** Approve, reject or per-hunk review a pending tool call (D16). */
  readonly onDecide?: (toolCallId: string, decision: ApprovalDecision) => void;
  /** Edit a user message: its new text becomes a sibling branch (D25). */
  readonly onEdit?: (message: Message, text: string) => void;
  readonly onFeedback?: (input: FeedbackInput) => void;
  readonly onOpenArtifact?: (ref: ArtifactRefPart) => void;
  /** Answer the user message behind this assistant message again. */
  readonly onRegenerate?: (message: Message) => void;
  /** Switch the branch to this sibling message. */
  readonly onSelectBranch?: (messageId: MessageId) => void;
  /** "Memory updated · Undo" (D20). */
  readonly onUndoMemory?: (update: MemoryUpdate) => Promise<void> | void;
}

type ActionKey = keyof ConversationActions;

const ActionsContext = createContext<ConversationActions>({});

/**
 * Hands rows the host's callbacks through a context whose value never
 * changes, each call reading the latest callback. Rows are memoised by
 * message (D28), so a parent re-rendering with fresh inline handlers must not
 * re-render every message.
 */
export function ConversationActionsProvider({
  actions,
  children,
}: {
  readonly actions: ConversationActions;
  readonly children: ReactNode;
}) {
  const latest = useRef(actions);
  useEffect(() => {
    latest.current = actions;
  });
  // Which actions exist decides which controls render; that changes rarely,
  // and when it does the rows must re-render.
  const present = (Object.keys(actions) as ActionKey[])
    .filter((key) => actions[key] !== undefined)
    .sort()
    .join(",");

  const stable = useMemo((): ConversationActions => {
    const keys = present.split(",").filter(Boolean) as ActionKey[];
    const forward = <K extends ActionKey>(key: K) =>
      ((...args: unknown[]) =>
        (latest.current[key] as ((...a: unknown[]) => unknown) | undefined)?.(
          ...args
        )) as NonNullable<ConversationActions[K]>;
    return Object.fromEntries(keys.map((key) => [key, forward(key)]));
  }, [present]);

  return (
    <ActionsContext.Provider value={stable}>{children}</ActionsContext.Provider>
  );
}

export const useConversationActions = (): ConversationActions =>
  useContext(ActionsContext);
