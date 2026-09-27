import {
  type HunkReview,
  initialReviewState,
  type ReviewAction,
  reviewReducer,
  toApprovalDecision,
} from "@workspace/code-ui/review/review-state";
import type { ApprovalDecision } from "@workspace/contract/schemas/message-parts";
import type { ProposedEdit } from "@workspace/contract/schemas/runs";
import { type ChangeEvent, useCallback, useReducer } from "react";

// A synchronous stand-in for code-ui's DiffView in unit tests (ticket 037).
// The real one arrives as a lazy chunk and draws through @pierre/diffs, whose
// hunk controls only become visible once Shiki has highlighted the file: on a
// loaded CI runner that took long enough to time tests out, and the late
// layout shift moved buttons under the pointer. This one renders at once with
// the same accessible controls, driven by the same pure review model, so
// approval tests exercise the chat side (ApprovalCard, addEditReview) without
// waiting on the renderer. `conversation-view.lazy.test.tsx` keeps one test on
// the real lazy path. Test-only strings, so no Lingui.

export interface TestDiffViewProps {
  readonly edit: ProposedEdit;
  readonly onSubmitReview?: (decision: ApprovalDecision) => void;
}

export function TestDiffView({ edit, onSubmitReview }: TestDiffViewProps) {
  const [review, dispatch] = useReducer(
    reviewReducer,
    edit.hunks.map((hunk) => hunk.hunkId),
    initialReviewState
  );
  const submit = useCallback(() => {
    const decision = toApprovalDecision(review);
    if (decision.ok) {
      onSubmitReview?.(decision.value);
    }
  }, [onSubmitReview, review]);

  const pending = review.order.filter(
    (hunkId) => review.reviews[hunkId]?.decision === "pending"
  ).length;

  return (
    <section aria-label={`Diff of ${edit.path}`}>
      {onSubmitReview
        ? review.order.map((hunkId, index) => {
            const state = review.reviews[hunkId];
            return state ? (
              <TestHunkControls
                dispatch={dispatch}
                hunkId={hunkId}
                key={hunkId}
                number={index + 1}
                review={state}
              />
            ) : null;
          })
        : null}
      {onSubmitReview ? (
        <button disabled={pending > 0} onClick={submit} type="button">
          Submit review
        </button>
      ) : null}
    </section>
  );
}

function TestHunkControls({
  dispatch,
  hunkId,
  number,
  review,
}: {
  readonly dispatch: (action: ReviewAction) => void;
  readonly hunkId: string;
  readonly number: number;
  readonly review: HunkReview;
}) {
  const toggle = useCallback(
    (decision: "accept" | "reject") =>
      dispatch({
        decision: review.decision === decision ? "pending" : decision,
        hunkId,
        type: "decide",
      }),
    [dispatch, hunkId, review.decision]
  );
  const accept = useCallback(() => toggle("accept"), [toggle]);
  const reject = useCallback(() => toggle("reject"), [toggle]);
  const comment = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) =>
      dispatch({ comment: event.target.value, hunkId, type: "comment" }),
    [dispatch, hunkId]
  );
  return (
    <div data-decision={review.decision} data-hunk-id={hunkId}>
      <button
        aria-label={`Accept change ${number}`}
        aria-pressed={review.decision === "accept"}
        onClick={accept}
        type="button"
      >
        Accept
      </button>
      <button
        aria-label={`Reject change ${number}`}
        aria-pressed={review.decision === "reject"}
        onClick={reject}
        type="button"
      >
        Reject
      </button>
      {review.decision === "reject" ? (
        <textarea
          aria-label={`Comment for the agent on change ${number}`}
          onChange={comment}
          value={review.comment}
        />
      ) : null}
    </div>
  );
}
