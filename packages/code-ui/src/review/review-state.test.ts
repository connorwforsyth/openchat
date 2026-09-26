import { approvalDecisionSchema } from "@workspace/contract/schemas/message-parts";
import { describe, expect, it } from "vitest";

import {
  initialReviewState,
  type ReviewAction,
  reviewReducer,
  summarizeReview,
  toApprovalDecision,
} from "./review-state";

const run = (actions: readonly ReviewAction[]) =>
  actions.reduce(reviewReducer, initialReviewState(["h1", "h2", "h3"]));

describe("reviewReducer", () => {
  it("starts with every hunk pending", () => {
    expect(summarizeReview(run([]))).toEqual({
      accepted: 0,
      pending: 3,
      rejected: 0,
    });
  });

  it("accepts one hunk and rejects another", () => {
    const state = run([
      { decision: "accept", hunkId: "h1", type: "decide" },
      { decision: "reject", hunkId: "h2", type: "decide" },
    ]);
    expect(summarizeReview(state)).toEqual({
      accepted: 1,
      pending: 1,
      rejected: 1,
    });
  });

  it("ignores ids the proposal doesn't have", () => {
    const before = run([]);
    const after = reviewReducer(before, {
      decision: "accept",
      hunkId: "nope",
      type: "decide",
    });
    expect(after).toBe(before);
  });

  it("decides only the pending hunks with decide-rest", () => {
    const state = run([
      { decision: "reject", hunkId: "h2", type: "decide" },
      { decision: "accept", type: "decide-rest" },
    ]);
    expect(state.reviews.h2?.decision).toBe("reject");
    expect(summarizeReview(state)).toEqual({
      accepted: 2,
      pending: 0,
      rejected: 1,
    });
  });

  it("doesn't mutate the previous state", () => {
    const before = run([]);
    reviewReducer(before, { decision: "accept", hunkId: "h1", type: "decide" });
    expect(before.reviews.h1?.decision).toBe("pending");
  });

  it("resets to pending", () => {
    const state = run([
      { decision: "accept", type: "decide-rest" },
      { comment: "no", hunkId: "h1", type: "comment" },
      { type: "reset" },
    ]);
    expect(state).toEqual(initialReviewState(["h1", "h2", "h3"]));
  });
});

describe("toApprovalDecision", () => {
  it("refuses while hunks are pending", () => {
    const result = toApprovalDecision(
      run([{ decision: "accept", hunkId: "h1", type: "decide" }])
    );
    expect(result).toEqual({
      error: { kind: "undecided", pending: ["h2", "h3"] },
      ok: false,
    });
  });

  it("emits the contract's review decision in file order", () => {
    const result = toApprovalDecision(
      run([
        { decision: "reject", hunkId: "h3", type: "decide" },
        { comment: "  Keep the old name  ", hunkId: "h3", type: "comment" },
        { decision: "accept", hunkId: "h1", type: "decide" },
        { decision: "reject", hunkId: "h2", type: "decide" },
      ])
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(approvalDecisionSchema.parse(result.value)).toEqual({
      comments: [],
      decision: "review",
      hunks: [
        { decision: "accept", hunkId: "h1" },
        { decision: "reject", hunkId: "h2" },
        { comment: "Keep the old name", decision: "reject", hunkId: "h3" },
      ],
    });
  });

  it("drops a comment once its hunk is accepted", () => {
    const result = toApprovalDecision(
      run([
        { decision: "reject", hunkId: "h1", type: "decide" },
        { comment: "Why?", hunkId: "h1", type: "comment" },
        { decision: "accept", type: "decide-rest" },
        { decision: "accept", hunkId: "h1", type: "decide" },
      ])
    );
    expect(result.ok && result.value.decision === "review").toBe(true);
    if (result.ok && result.value.decision === "review") {
      expect(result.value.hunks[0]).toEqual({
        decision: "accept",
        hunkId: "h1",
      });
    }
  });
});
