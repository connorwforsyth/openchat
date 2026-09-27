import type { ApprovalDecision } from "@workspace/contract/schemas/message-parts";
import type {
  PendingApproval,
  ProposedEdit,
} from "@workspace/contract/schemas/runs";

// A tool call that edits several files is one approval: DiffView reviews one
// file at a time, and the per-file reviews combine into the single `review`
// decision the run expects (D16: only accepted hunks apply).

type Review = Extract<ApprovalDecision, { decision: "review" }>;

/** Per-file reviews collected so far, by path. */
export type EditReviews = Readonly<Record<string, Review>>;

/** The edits a pending call proposes, if the run attached any. */
export const editsFor = (
  approvals: readonly PendingApproval[] | undefined,
  toolCallId: string
): readonly ProposedEdit[] =>
  approvals?.find((approval) => approval.toolCallId === toolCallId)?.edits ??
  [];

/**
 * Records one file's review. Returns the combined decision once every edit
 * has one, else `null` (keep collecting).
 */
export const addEditReview = (
  edits: readonly ProposedEdit[],
  reviews: EditReviews,
  path: string,
  decision: ApprovalDecision
): { readonly combined: Review | null; readonly reviews: EditReviews } => {
  if (decision.decision !== "review") {
    return { combined: null, reviews };
  }
  const next = { ...reviews, [path]: decision };
  const all = edits.map((edit) => next[edit.path]);
  if (all.some((review) => review === undefined)) {
    return { combined: null, reviews: next };
  }
  const done = all as readonly Review[];
  return {
    combined: {
      comments: done.flatMap((review) => review.comments),
      decision: "review",
      hunks: done.flatMap((review) => review.hunks),
    },
    reviews: next,
  };
};
