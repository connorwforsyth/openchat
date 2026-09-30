import type { ProposedEdit } from "@workspace/contract/schemas/runs";
import { describe, expect, it } from "vitest";

import {
  addEditReview,
  baseHashOf,
  EMPTY_FILE_HASH,
  editsFor,
  staleEdits,
} from "./approval";

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

describe("staleEdits", () => {
  const hash = (char: string) => char.repeat(64);
  const stamped = (path: string, base: string | null): ProposedEdit => ({
    hunks: [
      { hunkId: "h1", newLines: 1, newStart: 1, oldLines: 1, oldStart: 1 },
    ],
    patch: `--- ${path}${base ? `\tsha256:${base}` : ""}\n+++ ${path}\n@@ -1 +1 @@\n-a\n+b\n`,
    path,
  });

  it("names the files that changed since the change was proposed", () => {
    const edits = [stamped("a.txt", hash("a")), stamped("b.txt", hash("b"))];
    expect(baseHashOf(edits[0] as ProposedEdit)).toBe(hash("a"));
    expect(
      staleEdits(
        edits,
        new Map([
          ["a.txt", hash("a")],
          ["b.txt", hash("c")],
        ])
      )
    ).toEqual(["b.txt"]);
  });

  it("treats a missing file as empty, and unknowns as unchanged", () => {
    expect(
      staleEdits(
        [stamped("new.txt", EMPTY_FILE_HASH)],
        new Map([["new.txt", null]])
      )
    ).toEqual([]);
    expect(
      staleEdits(
        [stamped("new.txt", EMPTY_FILE_HASH)],
        new Map([["new.txt", hash("d")]])
      )
    ).toEqual(["new.txt"]);
    expect(staleEdits([stamped("x.txt", hash("a"))], new Map())).toEqual([]);
    expect(
      staleEdits([stamped("x.txt", null)], new Map([["x.txt", hash("z")]]))
    ).toEqual([]);
  });
});
