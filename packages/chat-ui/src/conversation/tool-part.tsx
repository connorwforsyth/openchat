"use client";

import { SCHEDULE_TASK_TOOL } from "@workspace/ai/schedules/tool";
import { isSkillAuthoringTool } from "@workspace/ai/tools/registry/skill-authoring";
import type { ApprovalDecision } from "@workspace/contract/schemas/message-parts";
import type { PendingApproval } from "@workspace/contract/schemas/runs";
import { memo, type ReactNode, useCallback, useMemo } from "react";

import { editsFor } from "../model/approval";
import type { ToolCallPart, ToolResultPart } from "../model/parts";
import { toolSummary } from "../model/tool-summary";
import { useConversationActions } from "./actions";
import { ApprovalCard } from "./approval";
import { useRunActivity } from "./approval-state";
import { FileChangeCard } from "./file-change-card";
import { GeneratedImages } from "./generated-images";
import { type ProposalState, ScheduleProposal } from "./schedule-card";
import { SkillApprovalSubject, SkillCard } from "./skill-card";
import { ToolStatus } from "./tool-status";

/** What the approval card shows for calls with a richer subject than JSON. */
const approvalSubject = (proposal: boolean, call: ToolCallPart): ReactNode => {
  if (proposal) {
    return <ScheduleProposal input={call.input} state="proposed" />;
  }
  if (isSkillAuthoringTool(call.toolName)) {
    return <SkillApprovalSubject input={call.input} tool={call.toolName} />;
  }
  return undefined;
};

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
  const { checking, decisions, onRetry, stale } = useRunActivity();
  const summary = useMemo(() => toolSummary(call, result), [call, result]);
  const decide = useCallback(
    (decision: ApprovalDecision) => onDecide?.(call.toolCallId, decision),
    [call.toolCallId, onDecide]
  );
  const retry = useCallback(
    () => onRetry?.(call.toolCallId),
    [call.toolCallId, onRetry]
  );

  const proposal = call.toolName === SCHEDULE_TASK_TOOL;
  const proposalState: ProposalState = (() => {
    if (summary.status === "awaiting") {
      return "proposed";
    }
    if (result?.output.status === "success") {
      const { value } = result.output;
      return typeof value === "object" &&
        value !== null &&
        "ok" in value &&
        value.ok === true
        ? "scheduled"
        : "failed";
    }
    return result?.output.status === "denied" ? "dismissed" : "proposed";
  })();

  return (
    <div className="flex flex-col gap-2">
      {proposal && summary.status !== "awaiting" ? (
        <ScheduleProposal input={call.input} state={proposalState} />
      ) : null}
      {summary.detail.kind === "file-change" ? (
        <FileChangeCard change={summary.detail.change} />
      ) : null}
      {summary.detail.kind === "skill" ? (
        <SkillCard detail={summary.detail} />
      ) : null}
      {summary.detail.kind === "image" ? (
        <GeneratedImages detail={summary.detail} />
      ) : null}
      {proposal ||
      summary.detail.kind === "file-change" ||
      summary.detail.kind === "image" ||
      summary.detail.kind === "skill" ? null : (
        <ToolStatus
          onOpenPreview={onOpenPreview}
          stopped={!(streaming || running) && summary.status === "running"}
          summary={summary}
        />
      )}
      {summary.status === "awaiting" && onDecide ? (
        <ApprovalCard
          checking={checking}
          edits={editsFor(approvals, call.toolCallId)}
          onDecide={decide}
          onRetry={onRetry ? retry : undefined}
          stale={stale?.has(call.toolCallId) ?? false}
          state={decisions.get(call.toolCallId)}
          subject={approvalSubject(proposal, call)}
          toolName={call.toolName}
        />
      ) : null}
    </div>
  );
});
