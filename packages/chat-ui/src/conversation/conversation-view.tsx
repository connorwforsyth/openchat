"use client";

import { useLingui } from "@lingui/react/macro";
import type { MessageId } from "@workspace/contract/schemas/common";
import type {
  Message,
  SiblingInfo,
} from "@workspace/contract/schemas/messages";
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
import {
  type ConversationActions,
  ConversationActionsProvider,
} from "./actions";
import type { MessageFeedback } from "./feedback";
import { MessageRow } from "./message-row";

export interface ConversationViewProps {
  readonly actions: ConversationActions;
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
  /** Approvals the current run waits on, with any proposed edits. */
  readonly pendingApprovals?: readonly PendingApproval[];
  readonly siblings: readonly SiblingInfo[];
  /** The assistant message being written right now, if any. */
  readonly streamingMessageId?: MessageId | null;
}

const NO_RESULTS: readonly ToolResultPart[] = [];

/**
 * The conversation (D27): not virtualised (conversations are short and
 * find-in-page matters); older rows skip rendering while off screen via
 * `content-visibility: auto`, and the streaming row re-renders in place.
 */
export function ConversationView({
  actions,
  className,
  conversationKey,
  empty,
  error,
  feedback,
  messages,
  pendingApprovals,
  siblings,
  streamingMessageId = null,
}: ConversationViewProps) {
  const { t } = useLingui();
  const visible = useMemo(
    () => messages.filter((message) => message.role !== "system"),
    [messages]
  );
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

  if (visible.length === 0 && !error) {
    return <>{empty}</>;
  }

  return (
    <ConversationActionsProvider actions={actions}>
      <MessageScrollerProvider autoScroll key={conversationKey}>
        <MessageScroller className={className}>
          <MessageScrollerViewport aria-label={t`Conversation`}>
            <MessageScrollerContent className="mx-auto w-full max-w-3xl px-4 pt-6 pb-10">
              {rows.map((row, index) => {
                const streaming = row.message.id === streamingMessageId;
                const last = index === rows.length - 1;
                return (
                  <MessageScrollerItem
                    // The live row must always lay out, or streaming text
                    // would size against a placeholder.
                    className={cn(
                      (streaming || last) && "[content-visibility:visible]"
                    )}
                    key={row.message.id}
                    messageId={row.message.id}
                    scrollAnchor={row.message.role === "user"}
                  >
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
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>
    </ConversationActionsProvider>
  );
}
