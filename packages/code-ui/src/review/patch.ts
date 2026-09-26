import {
  type FileDiffMetadata,
  type Hunk,
  parsePatchFiles,
} from "@pierre/diffs";
import type { ProposedEdit } from "@workspace/contract/schemas/runs";
import { err, ok, type Result, tryCatch } from "@workspace/shared/result";
import { z } from "zod";

export type { ProposedEdit } from "@workspace/contract/schemas/runs";

// A write/edit tool proposes a unified diff plus the hunk ids the reviewer
// decides on (`ProposedEdit`, PLAN.md D16). This module turns that into
// @pierre/diffs metadata and pairs each rendered hunk with its contract id, so
// the view, the reducer and the applier all agree on what "hunk h2" is.

export const patchErrorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("unparseable"), message: z.string() }),
  z.object({ kind: z.literal("no-hunks") }),
  z.object({
    kind: z.literal("hunk-mismatch"),
    /** Contract hunk ids with no parsed hunk at the same ranges. */
    missing: z.array(z.string()),
  }),
]);
export type PatchError = z.infer<typeof patchErrorSchema>;

/** Where a hunk's review controls sit: its last changed line. */
export const hunkAnchorSchema = z.object({
  lineNumber: z.int().min(1),
  side: z.enum(["additions", "deletions"]),
});
export type HunkAnchor = z.infer<typeof hunkAnchorSchema>;

export interface ReviewHunk {
  readonly anchor: HunkAnchor;
  readonly hunkId: string;
  /** Index into `fileDiff.hunks`. */
  readonly index: number;
}

export interface ParsedEdit {
  readonly fileDiff: FileDiffMetadata;
  /** In file order. */
  readonly hunks: readonly ReviewHunk[];
  readonly path: string;
}

const HUNK_START = /^@@ /m;

/**
 * Rewrites the patch's file header to the edit's path. Tool patches may have
 * no header at all (`@@ …` only), or `a/`/`b/` prefixes that @pierre/diffs
 * would read as a rename; the edit's `path` is authoritative either way.
 */
export function normalisePatch(path: string, patch: string): string {
  const start = patch.search(HUNK_START);
  const body = start === -1 ? patch : patch.slice(start);
  return `--- ${path}\n+++ ${path}\n${body}`;
}

/** The last changed line of a hunk, on the side that has one. */
export function hunkAnchor(hunk: Hunk): HunkAnchor {
  let anchor: HunkAnchor | undefined;
  let deletionLine = hunk.deletionStart;
  let additionLine = hunk.additionStart;
  for (const content of hunk.hunkContent) {
    if (content.type === "context") {
      deletionLine += content.lines;
      additionLine += content.lines;
      continue;
    }
    if (content.additions > 0) {
      anchor = {
        lineNumber: additionLine + content.additions - 1,
        side: "additions",
      };
    } else if (content.deletions > 0) {
      anchor = {
        lineNumber: deletionLine + content.deletions - 1,
        side: "deletions",
      };
    }
    deletionLine += content.deletions;
    additionLine += content.additions;
  }
  return (
    anchor ?? {
      lineNumber: Math.max(1, hunk.additionStart),
      side: "additions",
    }
  );
}

/**
 * Pairs parsed hunks with the contract's hunk ids by their ranges. Ranges, not
 * positions, so a proposal listing its hunks out of order still lines up.
 */
export function matchHunks(
  proposed: ProposedEdit["hunks"],
  parsed: readonly Hunk[]
): Result<readonly ReviewHunk[], PatchError> {
  const missing: string[] = [];
  const matched: ReviewHunk[] = [];
  for (const hunk of proposed) {
    const index = parsed.findIndex(
      (candidate) =>
        candidate.deletionStart === hunk.oldStart &&
        candidate.deletionCount === hunk.oldLines &&
        candidate.additionStart === hunk.newStart &&
        candidate.additionCount === hunk.newLines
    );
    const found = parsed[index];
    if (found === undefined) {
      missing.push(hunk.hunkId);
      continue;
    }
    matched.push({ anchor: hunkAnchor(found), hunkId: hunk.hunkId, index });
  }
  if (missing.length > 0) {
    return err({ kind: "hunk-mismatch", missing });
  }
  return ok([...matched].sort((a, b) => a.index - b.index));
}

/** Parses a proposed edit into renderable diff metadata plus its review hunks. */
export function parseProposedEdit(
  edit: ProposedEdit
): Result<ParsedEdit, PatchError> {
  const parsed = tryCatch(
    () => parsePatchFiles(normalisePatch(edit.path, edit.patch)),
    (cause): PatchError => ({
      kind: "unparseable",
      message: cause instanceof Error ? cause.message : String(cause),
    })
  );
  if (!parsed.ok) {
    return parsed;
  }
  const fileDiff = parsed.value[0]?.files[0];
  if (fileDiff === undefined || fileDiff.hunks.length === 0) {
    return err({ kind: "no-hunks" });
  }
  const hunks = matchHunks(edit.hunks, fileDiff.hunks);
  if (!hunks.ok) {
    return hunks;
  }
  return ok({ fileDiff, hunks: hunks.value, path: edit.path });
}
