import {
  type ApprovalDecision,
  hunkDecisionSchema,
} from "@workspace/contract/schemas/message-parts";
import { err, ok, type Result } from "@workspace/shared/result";
import { z } from "zod";

export type {
  ApprovalDecision,
  HunkDecision,
} from "@workspace/contract/schemas/message-parts";

// Per-hunk review of one proposed edit (PLAN.md D16), as a pure reducer: the
// DiffView dispatches, and `toApprovalDecision` turns a finished review into
// the contract's `review` decision the run executor applies.

const hunkIdSchema = hunkDecisionSchema.shape.hunkId;
const commentSchema = z.string().max(4000);

export const hunkReviewSchema = z.object({
  /** Kept while the decision flips, but only sent with a rejection. */
  comment: commentSchema,
  decision: z.enum(["pending", "accept", "reject"]),
});
export type HunkReview = z.infer<typeof hunkReviewSchema>;

export const reviewStateSchema = z.object({
  /** Hunk ids in file order; decisions are reported in this order. */
  order: z.array(hunkIdSchema),
  reviews: z.record(hunkIdSchema, hunkReviewSchema),
});
export type ReviewState = z.infer<typeof reviewStateSchema>;

export const reviewActionSchema = z.discriminatedUnion("type", [
  z.object({
    decision: z.enum(["pending", "accept", "reject"]),
    hunkId: hunkIdSchema,
    type: z.literal("decide"),
  }),
  z.object({
    comment: commentSchema,
    hunkId: hunkIdSchema,
    type: z.literal("comment"),
  }),
  /** Decides every hunk still pending; decided hunks keep their decision. */
  z.object({
    decision: z.enum(["accept", "reject"]),
    type: z.literal("decide-rest"),
  }),
  z.object({ type: z.literal("reset") }),
]);
export type ReviewAction = z.infer<typeof reviewActionSchema>;

export function initialReviewState(hunkIds: readonly string[]): ReviewState {
  return {
    order: [...hunkIds],
    reviews: Object.fromEntries(
      hunkIds.map((id) => [id, { comment: "", decision: "pending" }])
    ),
  };
}

const update = (
  state: ReviewState,
  hunkId: string,
  patch: Partial<HunkReview>
): ReviewState => {
  const current = state.reviews[hunkId];
  if (current === undefined) {
    // An id the proposal doesn't have: a stale control, ignore it.
    return state;
  }
  return {
    ...state,
    reviews: { ...state.reviews, [hunkId]: { ...current, ...patch } },
  };
};

export function reviewReducer(
  state: ReviewState,
  action: ReviewAction
): ReviewState {
  switch (action.type) {
    case "decide":
      return update(state, action.hunkId, { decision: action.decision });
    case "comment":
      return update(state, action.hunkId, { comment: action.comment });
    case "decide-rest":
      return {
        ...state,
        reviews: Object.fromEntries(
          Object.entries(state.reviews).map(([id, review]) => [
            id,
            review.decision === "pending"
              ? { ...review, decision: action.decision }
              : review,
          ])
        ),
      };
    case "reset":
      return initialReviewState(state.order);
    default: {
      const unreachable: never = action;
      return unreachable;
    }
  }
}

export interface ReviewSummary {
  readonly accepted: number;
  readonly pending: number;
  readonly rejected: number;
}

export function summarizeReview(state: ReviewState): ReviewSummary {
  const decisions = state.order.map(
    (id) => state.reviews[id]?.decision ?? "pending"
  );
  const count = (decision: HunkReview["decision"]) =>
    decisions.filter((value) => value === decision).length;
  return {
    accepted: count("accept"),
    pending: count("pending"),
    rejected: count("reject"),
  };
}

export const reviewIncompleteSchema = z.object({
  kind: z.literal("undecided"),
  pending: z.array(hunkIdSchema),
});
export type ReviewIncomplete = z.infer<typeof reviewIncompleteSchema>;

/**
 * The contract's `review` decision for a finished review. Every hunk must be
 * decided: an unanswered hunk is neither applied nor explained to the agent.
 */
export function toApprovalDecision(
  state: ReviewState
): Result<ApprovalDecision, ReviewIncomplete> {
  const pending = state.order.filter(
    (id) => (state.reviews[id]?.decision ?? "pending") === "pending"
  );
  if (pending.length > 0 || state.order.length === 0) {
    return err({ kind: "undecided", pending });
  }
  const hunks = state.order.flatMap((hunkId) => {
    const review = state.reviews[hunkId];
    if (review === undefined || review.decision === "pending") {
      return [];
    }
    const comment = review.comment.trim();
    return [
      review.decision === "reject" && comment !== ""
        ? { comment, decision: review.decision, hunkId }
        : { decision: review.decision, hunkId },
    ];
  });
  return ok({ comments: [], decision: "review", hunks });
}
