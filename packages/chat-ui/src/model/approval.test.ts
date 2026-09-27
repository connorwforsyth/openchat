import type { ProposedEdit } from "@workspace/contract/schemas/runs";
import { describe, expect, it } from "vitest";

import { addEditReview, editsFor } from "./approval";

const edit = (path: string, hunkId: string): ProposedEdit => ({
  hunks: [{ hunkId, newLines: 1, newStart: 1, oldLines: 1, oldStart: 1 }],
  patch: "@@ -1,1 +1,1 @@\n-a\n+b\n",
  path,
});

describe("addEditReview", () => {
  const edits = [edit("a.ts", "h1"), edit("b.ts", "h2")];

  it("waits for every file, then combines hunks and comments", () => {
    const first = addEditReview(edits, {}, "a.ts", {
      comments: [],
      decision: "review",
      hunks: [{ decision: "accept", hunkId: "h1" }],
    });
    expect(first.combined).toBeNull();
    const second = addEditReview(edits, first.reviews, "b.ts", {
      comments: [{ line: 1, path: "b.ts", text: "no" }],
      decision: "review",
      hunks: [{ comment: "keep", decision: "reject", hunkId: "h2" }],
    });
    expect(second.combined).toEqual({
      comments: [{ line: 1, path: "b.ts", text: "no" }],
      decision: "review",
      hunks: [
        { decision: "accept", hunkId: "h1" },
        { comment: "keep", decision: "reject", hunkId: "h2" },
      ],
    });
  });

  it("ignores decisions that aren't reviews", () => {
    expect(addEditReview(edits, {}, "a.ts", { decision: "approve" })).toEqual({
      combined: null,
      reviews: {},
    });
  });
});

describe("editsFor", () => {
  it("finds the edits proposed for a call", () => {
    const approvals = [
      {
        edits: [edit("a.ts", "h1")],
        input: {},
        requestedAt: "2026-09-27T09:00:00.000Z",
        toolCallId: "c1",
        toolName: "edit",
      },
    ];
    expect(editsFor(approvals, "c1")).toHaveLength(1);
    expect(editsFor(approvals, "c2")).toEqual([]);
    expect(editsFor(undefined, "c1")).toEqual([]);
  });
});
