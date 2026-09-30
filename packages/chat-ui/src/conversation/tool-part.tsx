"use client";

import type { ApprovalDecision } from "@workspace/contract/schemas/message-parts";
import type { PendingApproval } from "@workspace/contract/schemas/runs";
import { memo, useCallback, useMemo } from "react";

import { editsFor } from "../model/approval";
import type { ToolCallPart, ToolResultPart } from "../model/parts";
import { toolSummary } from "../model/tool-summary";
import { useConversationActions } from "./actions";
import { ApprovalCard } from "./approval";
import { useRunActivity } from "./approval-state";
import { FileChangeCard } from "./file-change-card";
import { ToolStatus } from "./tool-status";

/**
 * A tool call and (once it lands, maybe in a later message) its result: a
 * status line, or a card for a file the agent changed. A call waiting on
 * approval keeps the approval card, with per-hunk review for file changes.
 * A call with no result in a message that has stopped streaming, whose run
 * isn't going any more, never will get one, so it stops spinning. A call a
 * stopped run left behind has a result saying so ("Stopped by you").
 */
export const ToolPart = memo(function ToolPartInner({
  approvals,
  call,
  result,
  running = false,
  streaming,
}: {
  readonly approvals: readonly PendingApproval[] | undefined;
  readonly call: ToolCallPart;
  readonly result: ToolResultPart | undefined;
  /**
   * Whether the answer's run is still going (072): a call it hasn't
   * finished is still running there, even when this page isn't following
   * the stream, so it doesn't read "Stopped".
   */
  readonly running?: boolean;
  /** Whether the message holding the call is still being written. */
  readonly streaming: boolean;
}) {
  const { onDecide, onOpenPreview } = useConversationActions();
  const { decisions, onRetry } = useRunActivity();
  const summary = useMemo(() => toolSummary(call, result), [call, result]);
  const decide = useCallback(
    (decision: ApprovalDecision) => onDecide?.(call.toolCallId, decision),
    [call.toolCallId, onDecide]
  );
  const retry = useCallback(
    () => onRetry?.(call.toolCallId),
    [call.toolCallId, onRetry]
  );

  return (
    <div className="flex flex-col gap-2">
      {summary.detail.kind === "file-change" ? (
        <FileChangeCard change={summary.detail.change} />
      ) : (
        <ToolStatus
          onOpenPreview={onOpenPreview}
          stopped={!(streaming || running) && summary.status === "running"}
          summary={summary}
        />
      )}
      {summary.status === "awaiting" && onDecide ? (
        <ApprovalCard
          edits={editsFor(approvals, call.toolCallId)}
          onDecide={decide}
          onRetry={onRetry ? retry : undefined}
          state={decisions.get(call.toolCallId)}
          toolName={call.toolName}
        />
      ) : null}
    </div>
  );
});
