import type { ApprovalDecision } from "@workspace/contract/schemas/message-parts";

// How our approval decisions read to the AI SDK, which only knows yes or no
// plus a reason. The full decision (per-hunk review, comments) stays ours:
// write/edit tools look it up by tool call id when they run.

/**
 * The AI SDK approval id for a call. We key approvals by `toolCallId` (the
 * contract has no approval id), so rebuilding history always pairs a request
 * with its response. Nothing here signs approvals: the server holds the
 * decisions, the client never replays them.
 */
export const approvalIdFor = (toolCallId: string): string => toolCallId;

/** A review goes ahead if any hunk was accepted; only those are applied. */
export const isApproved = (decision: ApprovalDecision): boolean => {
  switch (decision.decision) {
    case "approve":
      return true;
    case "reject":
      return false;
    case "review":
      return decision.hunks.some((hunk) => hunk.decision === "accept");
    default:
      return decision satisfies never;
  }
};

/** What the model is told alongside a decision, if anything. */
export const approvalReason = (
  decision: ApprovalDecision
): string | undefined => {
  switch (decision.decision) {
    case "approve":
      return;
    case "reject":
      return decision.reason;
    case "review": {
      const accepted = decision.hunks.filter(
        (h) => h.decision === "accept"
      ).length;
      const lines = [
        `Reviewer accepted ${accepted} of ${decision.hunks.length} hunks.`,
        ...decision.hunks
          .filter((h) => h.comment)
          .map((h) => `Hunk ${h.hunkId}: ${h.comment}`),
        ...decision.comments.map((c) => `${c.path}:${c.line}: ${c.text}`),
      ];
      return lines.join("\n");
    }
    default:
      return decision satisfies never;
  }
};
