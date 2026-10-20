"use client";

import { useLingui } from "@lingui/react/macro";
import type { AgentOption } from "@workspace/composer/schemas";
import type { MessageId } from "@workspace/contract/schemas/common";
import type {
  Message,
  SiblingInfo,
} from "@workspace/contract/schemas/messages";
import type { ModelOption } from "@workspace/contract/schemas/models";
import type { PendingApproval } from "@workspace/contract/schemas/runs";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@workspace/ui/components/message-scroller";
import { cn } from "@workspace/ui/lib/utils";
import { type ReactNode, useMemo } from "react";

import { indexToolResults, type ToolResultPart } from "../model/parts";
import { quietRuns, scheduledTaskOf } from "../model/scheduled";
import {
  type ConversationActions,
  ConversationActionsProvider,
} from "./actions";
import type { MessageFeedback } from "./feedback";
import { MessageRow } from "./message-row";
import { QuietRunNote } from "./scheduled-note";
import { SwitchMarker } from "./switch-marker";
import { answerSwitches } from "./switches";

export interface ConversationViewProps {
  readonly actions: ConversationActions;
  /** The caller's agents, to name the agent a marker switches to (107). */
  readonly agents?: readonly AgentOption[];
  readonly className?: string;
  /** Changes when a different chat opens, resetting scroll. */
  readonly conversationKey: string;
  /** What shows before the first message. */
  readonly empty?: ReactNode;
  /** A run-level problem, shown after the last message (with its own retry). */
  readonly error?: ReactNode;
  readonly feedback?: Readonly<Record<string, MessageFeedback>>;
  /** The branch being shown, root first (`messages.path`). */
  readonly messages: readonly Message[];
  /** The model list, to name the model a marker switches to (107). */
  readonly models?: readonly ModelOption[];
  /** Approvals the current run waits on, with any proposed edits. */
  readonly pendingApprovals?: readonly PendingApproval[];
  readonly siblings: readonly SiblingInfo[];
  /** The assistant message being written right now, if any. */
  readonly streamingMessageId?: MessageId | null;
}

const NO_RESULTS: readonly ToolResultPart[] = [];
const NO_AGENTS: readonly AgentOption[] = [];
const NO_MODELS: readonly ModelOption[] = [];

/**
 * The conversation (D27): not virtualised (conversations are short and
 * find-in-page matters); older rows skip rendering while off screen via
 * `content-visibility: auto`, and the streaming row re-renders in place.
 */
export function ConversationView({
  actions,
  agents = NO_AGENTS,
  className,
  conversationKey,
  empty,
  error,
  feedback,
  messages,
  models = NO_MODELS,
  pendingApprovals,
  siblings,
  streamingMessageId = null,
}: ConversationViewProps) {
  const { t } = useLingui();
  const visible = useMemo(
    () => messages.filter((message) => message.role !== "system"),
    [messages]
  );
  // Markers follow the branch shown: `messages` is the active path.
  const switches = useMemo(() => answerSwitches(visible), [visible]);
  const siblingsById = useMemo(
    () => new Map(siblings.map((info) => [info.messageId, info])),
    [siblings]
  );

  // Per-row inputs, built so a row's props keep their identity unless its
  // own content changed (the row's memo compares items shallowly).
  const rows = useMemo(() => {
    const results = indexToolResults(visible);
    return visible.map((message) => {
      const callIds = message.parts.flatMap((part) =>
        part.type === "tool-call" ? [part.toolCallId] : []
      );
      const found = callIds.flatMap((id) => {
        const result = results.get(id);
        return result ? [result] : [];
      });
      const approvals = pendingApprovals?.filter((approval) =>
        callIds.includes(approval.toolCallId)
      );
      return {
        approvals: approvals && approvals.length > 0 ? approvals : undefined,
        message,
        results: found.length > 0 ? found : NO_RESULTS,
      };
    });
  }, [pendingApprovals, visible]);

  // A quiet scheduled run (no update) folds into one line (175).
  const quiet = useMemo(() => quietRuns(visible), [visible]);
  const foldedAnswers = useMemo(() => new Set(quiet.values()), [quiet]);

  // A new chat shows its empty state even with an error slot: the app passes
  // one that renders nothing until something fails, so an element there
  // doesn't mean there's an error to show. A real one shows under it.
  if (visible.length === 0) {
    return (
      <>
        {empty}
        {error ? (
          <div className="mx-auto w-full max-w-2xl px-6 pb-4">{error}</div>
        ) : null}
      </>
    );
  }

  return (
    <ConversationActionsProvider actions={actions}>
      <MessageScrollerProvider autoScroll key={conversationKey}>
        <MessageScroller className={className}>
          <MessageScrollerViewport aria-label={t`Conversation`}>
            <MessageScrollerContent className="mx-auto w-full max-w-2xl gap-6 px-6 pt-6 pb-10">
              {rows.map((row, index) => {
                if (foldedAnswers.has(row.message.id)) {
                  return null;
                }
                const quietTask = quiet.has(row.message.id)
                  ? scheduledTaskOf(row.message.parts)
                  : null;
                if (quietTask) {
                  return (
                    <MessageScrollerItem
                      key={row.message.id}
                      messageId={row.message.id}
                    >
                      <QuietRunNote task={quietTask} />
                    </MessageScrollerItem>
                  );
                }
                const streaming = row.message.id === streamingMessageId;
                const last = index === rows.length - 1;
                const change = switches.get(row.message.id);
                return (
                  <MessageScrollerItem
                    // The live row must always lay out, or streaming text
                    // would size against a placeholder.
                    className={cn(
                      (streaming || last) && "[content-visibility:visible]",
                      change && "flex flex-col gap-6"
                    )}
                    key={row.message.id}
                    messageId={row.message.id}
                    scrollAnchor={row.message.role === "user"}
                  >
                    {change ? (
                      <SwitchMarker
                        agents={agents}
                        models={models}
                        value={change}
                      />
                    ) : null}
                    <MessageRow
                      approvals={row.approvals}
                      feedback={feedback?.[row.message.id]}
                      message={row.message}
                      results={row.results}
                      siblings={siblingsById.get(row.message.id)}
                      streaming={streaming}
                    />
                  </MessageScrollerItem>
                );
              })}
              {error ? (
                <MessageScrollerItem className="[content-visibility:visible]">
                  {error}
                </MessageScrollerItem>
              ) : null}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton className="rounded-full shadow-sm" />
        </MessageScroller>
      </MessageScrollerProvider>
    </ConversationActionsProvider>
  );
}
