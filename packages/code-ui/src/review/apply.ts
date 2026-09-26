import type { FileDiffMetadata } from "@pierre/diffs";
import type { HunkDecision } from "@workspace/contract/schemas/message-parts";
import type { ProposedEdit } from "@workspace/contract/schemas/runs";
import { err, ok, type Result } from "@workspace/shared/result";
import { z } from "zod";

import { type PatchError, parseProposedEdit } from "./patch";

// Applying a reviewed edit: only accepted hunks change the file, rejected ones
// leave their lines as they were (PLAN.md D16). The original file is checked
// against the patch's context and deletions first, so a stale proposal fails
// loudly instead of splicing lines into the wrong place.

export const applyErrorSchema = z.discriminatedUnion("kind", [
  z.object({
    actual: z.string().nullable(),
    expected: z.string(),
    hunkIndex: z.int().min(0),
    kind: z.literal("context-mismatch"),
    /** 1-based line in the original file. */
    lineNumber: z.int().min(1),
  }),
  z.object({ hunkIndex: z.int().min(0), kind: z.literal("out-of-order") }),
]);
export type ApplyError = z.infer<typeof applyErrorSchema>;

const LINE_BREAK = /\r?\n$/;

/** Splits text into lines that keep their line endings, so joining is lossless. */
export function splitLines(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

const stripEol = (line: string): string => line.replace(LINE_BREAK, "");

/**
 * Applies the accepted hunks of a parsed patch to the original file text.
 * `accepted` holds indexes into `fileDiff.hunks`; every other hunk is left
 * unapplied.
 */
export function applyHunks(
  original: string,
  fileDiff: FileDiffMetadata,
  accepted: ReadonlySet<number>
): Result<string, ApplyError> {
  const lines = splitLines(original);
  const eol = original.includes("\r\n") ? "\r\n" : "\n";
  const output: string[] = [];
  let cursor = 0;

  // Checks the next `count` original lines against the patch's copy of them.
  const verify = (
    hunkIndex: number,
    expected: readonly string[]
  ): ApplyError | undefined => {
    for (const [offset, line] of expected.entries()) {
      const actual = lines[cursor + offset];
      if (actual === undefined || stripEol(actual) !== stripEol(line)) {
        return {
          actual: actual === undefined ? null : stripEol(actual),
          expected: stripEol(line),
          hunkIndex,
          kind: "context-mismatch",
          lineNumber: cursor + offset + 1,
        };
      }
    }
    return undefined;
  };

  for (const [hunkIndex, hunk] of fileDiff.hunks.entries()) {
    // `-L,0` inserts after line L; otherwise the hunk starts on line L.
    const start =
      hunk.deletionCount === 0 ? hunk.deletionStart : hunk.deletionStart - 1;
    if (start < cursor) {
      return err({ hunkIndex, kind: "out-of-order" });
    }
    output.push(...lines.slice(cursor, start));
    cursor = start;

    for (const content of hunk.hunkContent) {
      const size =
        content.type === "context" ? content.lines : content.deletions;
      const removed = fileDiff.deletionLines.slice(
        content.deletionLineIndex,
        content.deletionLineIndex + size
      );
      const mismatch = verify(hunkIndex, removed);
      if (mismatch !== undefined) {
        return err(mismatch);
      }
      if (content.type === "change" && accepted.has(hunkIndex)) {
        const added = fileDiff.additionLines.slice(
          content.additionLineIndex,
          content.additionLineIndex + content.additions
        );
        // Keep the file's own line endings; a line without one is the patch's
        // "no newline at end of file".
        output.push(
          ...added.map((line) =>
            LINE_BREAK.test(line) ? `${stripEol(line)}${eol}` : line
          )
        );
      } else {
        output.push(...lines.slice(cursor, cursor + size));
      }
      cursor += size;
    }
  }

  output.push(...lines.slice(cursor));
  return ok(output.join(""));
}

/**
 * Applies a reviewed edit: parses the proposal, then applies the hunks the
 * reviewer accepted. Hunks without a decision are not applied.
 */
export function applyReview(
  original: string,
  edit: ProposedEdit,
  decisions: readonly HunkDecision[]
): Result<string, PatchError | ApplyError> {
  const parsed = parseProposedEdit(edit);
  if (!parsed.ok) {
    return parsed;
  }
  const acceptedIds = new Set(
    decisions
      .filter((decision) => decision.decision === "accept")
      .map((decision) => decision.hunkId)
  );
  const accepted = new Set(
    parsed.value.hunks
      .filter((hunk) => acceptedIds.has(hunk.hunkId))
      .map((hunk) => hunk.index)
  );
  return applyHunks(original, parsed.value.fileDiff, accepted);
}
