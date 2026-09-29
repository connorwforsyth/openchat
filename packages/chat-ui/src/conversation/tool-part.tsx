"use client";

import type { ApprovalDecision } from "@workspace/contract/schemas/message-parts";
import type { PendingApproval } from "@workspace/contract/schemas/runs";
import { memo, useCallback, useMemo } from "react";

import { editsFor } from "../model/approval";
import type { ToolCallPart, ToolResultPart } from "../model/parts";
import { toolSummary } from "../model/tool-summary";
import { useConversationActions } from "./actions";
import { ApprovalCard } from "./approval";
import { FileChangeCard } from "./file-change-card";
import { ToolStatus } from "./tool-status";

/**
 * A tool call and (once it lands, maybe in a later message) its result: a
 * status line, or a card for a file the agent changed. A call waiting on
 * approval keeps the approval card, with per-hunk review for file changes.
 */
export const ToolPart = memo(function ToolPartInner({
  approvals,
  call,
  result,
}: {
  readonly approvals: readonly PendingApproval[] | undefined;
  readonly call: ToolCallPart;
  readonly result: ToolResultPart | undefined;
}) {
  const { onDecide } = useConversationActions();
  const summary = useMemo(() => toolSummary(call, result), [call, result]);
  const decide = useCallback(
    (decision: ApprovalDecision) => onDecide?.(call.toolCallId, decision),
    [call.toolCallId, onDecide]
  );

  return (
    <div className="flex flex-col gap-2">
      {summary.detail.kind === "file-change" ? (
        <FileChangeCard change={summary.detail.change} />
      ) : (
        <ToolStatus summary={summary} />
      )}
      {summary.status === "awaiting" && onDecide ? (
        <ApprovalCard
          edits={editsFor(approvals, call.toolCallId)}
          onDecide={decide}
          toolName={call.toolName}
        />
      ) : null}
    </div>
  );
});
