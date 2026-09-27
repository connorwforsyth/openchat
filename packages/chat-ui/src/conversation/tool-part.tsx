"use client";

import type { ApprovalDecision } from "@workspace/contract/schemas/message-parts";
import type { PendingApproval } from "@workspace/contract/schemas/runs";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@workspace/ui/components/ai-elements/tool";
import { memo, useCallback } from "react";

import { editsFor } from "../model/approval";
import {
  type ToolCallPart,
  type ToolResultPart,
  toolViewState,
} from "../model/parts";
import { useConversationActions } from "./actions";
import { ApprovalCard } from "./approval";

/** What the result says, for the output panel. */
const outputOf = (result: ToolResultPart | undefined) => {
  if (!result) {
    return { errorText: undefined, output: undefined };
  }
  switch (result.output.status) {
    case "success":
      return { errorText: undefined, output: result.output.value };
    case "error":
      return { errorText: result.output.message, output: undefined };
    case "denied":
      return { errorText: undefined, output: result.output.decision };
    default:
      return result.output satisfies never;
  }
};

/**
 * A tool call and (once it lands, maybe in a later message) its result. A
 * call waiting on approval opens with the approval card.
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
  const state = toolViewState(call, result);
  const pending = state === "approval-requested";
  const { errorText, output } = outputOf(result);
  const decide = useCallback(
    (decision: ApprovalDecision) => onDecide?.(call.toolCallId, decision),
    [call.toolCallId, onDecide]
  );

  return (
    <div className="flex flex-col gap-2">
      <Tool className="mb-0" defaultOpen={false}>
        <ToolHeader
          state={state}
          title={call.toolName}
          type={`tool-${call.toolName}`}
        />
        <ToolContent>
          <ToolInput input={call.input} />
          <ToolOutput errorText={errorText} output={output} />
        </ToolContent>
      </Tool>
      {pending && onDecide ? (
        <ApprovalCard
          edits={editsFor(approvals, call.toolCallId)}
          onDecide={decide}
          toolName={call.toolName}
        />
      ) : null}
    </div>
  );
});
