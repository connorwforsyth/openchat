"use client";

import type {
  ArtifactId,
  ArtifactVersionId,
  FileId,
  LibraryItemId,
  MessageId,
} from "@workspace/contract/schemas/common";
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
import type { PlanRef } from "../model/plan";

export type FeedbackInput = z.input<typeof setFeedbackInputSchema>;

/**
 * Everything a message can ask the host to do. All optional: a read-only
 * view (a shared link, a viewer's seat) leaves the matching controls out.
 */
export interface ConversationActions {
  /**
   * Where a generated image's bytes are served (138), by its artifact
   * version. Without it, the reply lists the pictures without showing them.
   */
  readonly artifactImageUrl?: (
    artifactId: ArtifactId,
    versionId: ArtifactVersionId
  ) => string;
  /** Where an uploaded file's bytes are served, for images and links. */
  readonly fileUrl?: (fileId: FileId) => string;
  /**
   * A library item's page, for a skill card's "Open in Library" (128).
   * Without it, the card has no link.
   */
  readonly libraryItemHref?: (id: LibraryItemId) => string;
  /** Approve a plan (106): a normal run carrying its latest version. */
  readonly onApprovePlan?: (plan: PlanRef) => void;
  readonly onClearFeedback?: (messageId: MessageId) => void;
  /** Approve, reject or per-hunk review a pending tool call (D16). */
  readonly onDecide?: (toolCallId: string, decision: ApprovalDecision) => void;
  /** Set a plan aside without building it (106). */
  readonly onDiscardPlan?: (plan: PlanRef) => void;
  /** Edit a user message: its new text becomes a sibling branch (D25). */
  readonly onEdit?: (message: Message, text: string) => void;
  /**
   * "Edit this image" (138): put a follow-up in the composer that edits the
   * picture at `path` in the workspace. Without it, there's no such button.
   */
  readonly onEditImage?: (image: {
    readonly path: string;
    readonly prompt: string;
  }) => void;
  /** Open a plan in the panel's editor (106). */
  readonly onEditPlan?: (plan: PlanRef) => void;
  readonly onFeedback?: (input: FeedbackInput) => void;
  readonly onOpenArtifact?: (ref: ArtifactRefPart) => void;
  /**
   * Open a workspace file the agent created or edited, by the path its
   * `write`/`edit` call used. Without it, file-change cards have no Open.
   */
  readonly onOpenFile?: (path: string) => void;
  /**
   * Open a preview the agent started, in the app. Without it, a preview
   * line's Open opens its URL in a new tab.
   */
  readonly onOpenPreview?: (url: string) => void;
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
