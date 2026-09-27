import type { ProposedEdit } from "@workspace/contract/schemas/runs";
import { formatPatch, structuredPatch } from "diff";

// A write or edit as a reviewable proposal (D16): a unified diff of the whole
// file plus one id per hunk, in the `ProposedEdit` shape `DiffView` renders
// and `applyReview` applies. Ids are positional (`h1`, `h2`, …): recomputing
// the proposal from the same file and input gives the same ids, which is how
// a decision made on the proposal finds its hunks at execution time.

const CONTEXT_LINES = 3;

/** The proposal for turning `before` into `after`, or `null` if they're equal. */
export const proposeEdit = (
  path: string,
  before: string,
  after: string
): ProposedEdit | null => {
  if (before === after) {
    return null;
  }
  const patch = structuredPatch(
    path,
    path,
    before,
    after,
    undefined,
    undefined,
    {
      context: CONTEXT_LINES,
    }
  );
  if (patch.hunks.length === 0) {
    return null;
  }
  return {
    // An empty side is numbered from the line before it (`-0,0` for a new
    // file), as `formatPatch` writes it and `DiffView` parses it.
    hunks: patch.hunks.map((hunk, index) => ({
      hunkId: `h${index + 1}`,
      newLines: hunk.newLines,
      newStart: hunk.newLines === 0 ? hunk.newStart - 1 : hunk.newStart,
      oldLines: hunk.oldLines,
      oldStart: hunk.oldLines === 0 ? hunk.oldStart - 1 : hunk.oldStart,
    })),
    patch: formatPatch(patch),
    path,
  };
};
