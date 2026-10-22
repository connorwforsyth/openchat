// Ported from open-slide (https://github.com/open-slide/open-slide), commit 1f18ab5,
// packages/core/src/editing/batch-edit.ts. MIT, Copyright (c) 2026 Yiwei Ho; see LICENSE.open-slide.
import { parseSource } from "./babel-walk";
import {
  applySplices,
  type EditOp,
  findElementForEdit,
  planEdit,
  type Splice,
} from "./edit-ops";

export interface BatchEdit {
  column?: number;
  dependsOn?: number;
  line?: number;
  ops?: readonly EditOp[];
}
export interface BatchEditResult {
  error?: string;
  ok: boolean;
}

interface TrackedEdit {
  dependsOn?: number;
  error?: string;
  offset: number | null;
  ops: readonly EditOp[];
}

function rebaseOffset(
  offset: number,
  splices: Splice[],
  target: number
): number | null {
  let shift = 0;
  for (const splice of splices) {
    if (offset < splice.from) {
      break;
    }
    if (offset >= splice.to) {
      shift += splice.text.length - (splice.to - splice.from);
    } else if (offset === splice.from && offset === target) {
      return offset + shift;
    } else {
      return null;
    }
  }
  return offset + shift;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: ported from open-slide; kept faithful for future syncs.
export function applyEditBatch(
  source: string,
  edits: readonly BatchEdit[]
): { source: string; results: BatchEditResult[] } {
  const ast = parseSource(source);
  const targets = new Map<number, number>();
  const textTargets = new Map<string, number>();
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: ported from open-slide; kept faithful for future syncs.
  const tracked: TrackedEdit[] = edits.map((edit, index) => {
    if (
      !(edit && Number.isInteger(edit.line)) ||
      (edit.line ?? 0) < 1 ||
      !Number.isInteger(edit.column ?? 0) ||
      (edit.column ?? 0) < 0 ||
      !Array.isArray(edit.ops) ||
      (edit.dependsOn !== undefined &&
        (!Number.isInteger(edit.dependsOn) ||
          edit.dependsOn < 0 ||
          edit.dependsOn >= index))
    ) {
      return { error: "invalid edit", offset: null, ops: [] };
    }
    if (!edit.ops.length) {
      return { dependsOn: edit.dependsOn, offset: null, ops: [] };
    }
    if (!ast) {
      return { error: "could not parse source", offset: null, ops: edit.ops };
    }
    const location = `${edit.line}:${edit.column ?? 0}:`;
    const textOp = edit.ops.find(
      (op) => "prevText" in op && op.prevText !== undefined
    );
    const prevText =
      textOp && "prevText" in textOp ? textOp.prevText : undefined;
    const offset =
      (edit.dependsOn === undefined
        ? undefined
        : targets.get(edit.dependsOn)) ??
      (prevText === undefined
        ? undefined
        : textTargets.get(`${location}${prevText}`)) ??
      findElementForEdit(ast, edit.line ?? 0, edit.column ?? 0, edit.ops)
        ?.start ??
      null;
    if (offset !== null) {
      targets.set(index, offset);
      for (const op of edit.ops) {
        if (op.kind === "set-text") {
          textTargets.set(`${location}${op.value}`, offset);
        }
      }
    }
    return {
      dependsOn: edit.dependsOn,
      offset,
      ops: edit.ops,
      ...(offset === null ? { error: "no JSX element at location" } : {}),
    };
  });
  let next = source;
  const results: BatchEditResult[] = [];
  for (const edit of tracked) {
    if (edit.dependsOn !== undefined && !results[edit.dependsOn]?.ok) {
      results.push({
        error: "an earlier edit for this text failed",
        ok: false,
      });
      continue;
    }
    if (edit.error) {
      results.push({ error: edit.error, ok: false });
      continue;
    }
    if (!edit.ops.length) {
      results.push({ ok: true });
      continue;
    }
    if (edit.offset === null) {
      results.push({
        error: "target was removed by an earlier edit",
        ok: false,
      });
      continue;
    }
    const before = next.slice(0, edit.offset);
    const line = before.split("\n").length;
    const column = edit.offset - before.lastIndexOf("\n") - 1;
    const plan = planEdit(next, line, column, edit.ops, true);
    if (!plan.ok) {
      results.push({ error: plan.error, ok: false });
      continue;
    }
    const result = plan.splices.length
      ? applySplices(next, plan.splices)
      : { ok: true as const, source: next };
    if (!result.ok) {
      results.push({ error: result.error, ok: false });
      continue;
    }
    const target = edit.offset;
    const splices = [...plan.splices].sort(
      (a, b) => a.from - b.from || a.to - b.to
    );
    for (const pending of tracked) {
      if (pending.offset !== null) {
        pending.offset = rebaseOffset(pending.offset, splices, target);
      }
    }
    next = result.source;
    results.push({ ok: true });
  }
  return { results, source: next };
}
