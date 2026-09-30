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

// A run that stops (Stop, a new message while a change waits, shutdown)
// leaves some tool calls without a result: a change still waiting on a
// person, or a command that was running. Each gets an error result, so the
// answer reads as finished history (the next turn's model sees why nothing
// happened) and every client drops the call's card or spinner (opencode's
// `interrupted`, ticket 072). The text is what the model reads; clients
// recognise it by its first line, never by parsing the rest.

/** Who stopped the run a call belonged to. */
export type InterruptedBy = "user" | "system";

const INTERRUPTED = {
  system: "Stopped before it finished: the server stopped the run.",
  user: "Stopped by the user before it finished.",
} as const satisfies Record<InterruptedBy, string>;

const SKIPPED = {
  system: "Not run: the server stopped the run before anyone decided.",
  user: "Not run: the user stopped the agent instead of deciding.",
} as const satisfies Record<InterruptedBy, string>;

const OUTPUT_SO_FAR = "Output so far:";

/**
 * The error a stopped call is left with. `started` is whether it was
 * running (a command gets its partial output) or still waiting on a
 * decision (it never ran).
 */
export const interruptedMessage = (
  by: InterruptedBy,
  started: boolean,
  partial?: string
): string => {
  const head = started ? INTERRUPTED[by] : SKIPPED[by];
  return partial ? `${head}\n\n${OUTPUT_SO_FAR}\n${partial}` : head;
};

export interface Interruption {
  readonly by: InterruptedBy;
  /** What the call had printed when it was stopped, if anything. */
  readonly partial: string | undefined;
  /** Whether it had started running. */
  readonly started: boolean;
}

/** Whether an error result is a stopped run's, and how. Pure. */
export const interruptionOf = (message: string): Interruption | null => {
  const [head = ""] = message.split("\n", 1);
  const by = (["user", "system"] as const).find(
    (who) => head === INTERRUPTED[who] || head === SKIPPED[who]
  );
  if (!by) {
    return null;
  }
  const marker = message.indexOf(`\n${OUTPUT_SO_FAR}\n`);
  return {
    by,
    partial:
      marker === -1
        ? undefined
        : message.slice(marker + OUTPUT_SO_FAR.length + 2),
    started: head === INTERRUPTED[by],
  };
};
