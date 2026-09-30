import { applyReview } from "@workspace/code-ui/review/apply";
import type { ApprovalDecision } from "@workspace/contract/schemas/message-parts";
import {
  type ProposedEdit,
  proposedEditSchema,
} from "@workspace/contract/schemas/runs";
import {
  type AsyncResult,
  err,
  ok,
  type Result,
} from "@workspace/shared/result";
import { z } from "zod";

import type { editInputSchema } from "./defs/edit";
import type { writeInputSchema } from "./defs/write";
import { proposeEdit } from "./patch";
import {
  describeError,
  failure,
  type Review,
  readText,
  type SandboxToolContext,
  type ToolSandbox,
  toolErrorSchema,
} from "./workspace";

// How `write` and `edit` change a file (D16). Neither touches it blindly:
// each computes a `ProposedEdit` first, and in `ask` mode the run executor
// shows it for per-hunk review and hands the decision back through
// `reviewFor`; only accepted hunks are applied. The proposal carries a hash
// of the file it was made from, so a file the user edited while the change
// waited isn't overwritten.

/** What `write` and `edit` return: the proposal and which hunks landed. */
export const fileChangeOutputSchema = z.discriminatedUnion("status", [
  z.object({ path: z.string(), status: z.literal("unchanged") }),
  z.object({
    applied: z.array(z.string()),
    edit: proposedEditSchema,
    /** The reviewer's comments (rejected hunks, lines), for the agent to act on (D16). */
    feedback: z.string().optional(),
    /** Rejected or undecided hunks; the file keeps their original lines. */
    rejected: z.array(z.string()),
    status: z.literal("changed"),
  }),
  toolErrorSchema,
]);
export type FileChangeOutput = z.infer<typeof fileChangeOutputSchema>;

export type ChangeInput =
  | { readonly input: z.infer<typeof writeInputSchema>; readonly kind: "write" }
  | { readonly input: z.infer<typeof editInputSchema>; readonly kind: "edit" };

const countOccurrences = (text: string, search: string): number =>
  text.split(search).length - 1;

interface PlannedChange {
  readonly after: string;
  readonly before: string;
  /** As the model wrote it, for the proposal it's shown. */
  readonly path: string;
  /** The checked path inside `/work` the change is written to. */
  readonly target: string;
}

/** The file before and after a write or edit, without writing anything. */
const planChange = async (
  sandbox: ToolSandbox,
  change: ChangeInput
): AsyncResult<PlannedChange, string> => {
  const { path } = change.input;
  const read = await readText(sandbox, path, {
    missingIsEmpty: change.kind === "write",
  });
  if (!read.ok) {
    return read;
  }
  const { target, text: before } = read.value;
  if (change.kind === "write") {
    return ok({ after: change.input.content, before, path, target });
  }
  const { newString, oldString, replaceAll } = change.input;
  const count = countOccurrences(before, oldString);
  if (count === 0) {
    return err(`oldString was not found in ${path}`);
  }
  if (count > 1 && !replaceAll) {
    return err(
      `oldString appears ${count} times in ${path}; add context to make it unique or set replaceAll`
    );
  }
  const after = replaceAll
    ? before.split(oldString).join(newString)
    : before.replace(oldString, () => newString);
  return ok({ after, before, path, target });
};

const encoder = new TextEncoder();

/** SHA-256 of the file a change was planned against, as hex. */
export const contentHash = async (text: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(text));
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
};

const BASE_HASH = /^--- [^\n]*\tsha256:([0-9a-f]{64})$/m;
const OLD_HEADER = /^--- [^\n\t]*$/m;

/**
 * Stamps the patch's `---` header with the hash of the file it was made
 * from, where a unified diff keeps a timestamp. The proposal is stored with
 * the pending approval and handed back with the decision, and the contract
 * has no field for it; `DiffView` reads from the first hunk, so the header
 * is free.
 */
const withBaseHash = (edit: ProposedEdit, hash: string): ProposedEdit => ({
  ...edit,
  patch: edit.patch.replace(OLD_HEADER, (line) => `${line}\tsha256:${hash}`),
});

/** The hash a proposal was made from; `undefined` for one made before hashes. */
export const baseHashOf = (edit: ProposedEdit): string | undefined =>
  BASE_HASH.exec(edit.patch.slice(0, edit.patch.indexOf("\n@@")))?.[1];

/** The proposal for a planned change, stamped with its file's hash. */
const proposalFor = async (planned: {
  readonly after: string;
  readonly before: string;
  readonly path: string;
}): Promise<ProposedEdit | null> => {
  const edit = proposeEdit(planned.path, planned.before, planned.after);
  return edit && withBaseHash(edit, await contentHash(planned.before));
};

/**
 * What a `write` or `edit` call would change, for the approval request the
 * run executor shows before asking (`PendingApproval.edits`).
 */
export const proposeSandboxChange = async (
  sandbox: ToolSandbox,
  change: ChangeInput
): AsyncResult<ProposedEdit | null, string> => {
  const planned = await planChange(sandbox, change);
  return planned.ok ? ok(await proposalFor(planned.value)) : planned;
};

/** Which hunk ids a decision lets through. */
const acceptedHunks = (
  hunkIds: readonly string[],
  decision: ApprovalDecision | undefined
): ReadonlySet<string> => {
  if (decision === undefined) {
    return new Set(hunkIds);
  }
  switch (decision.decision) {
    case "approve":
      return new Set(hunkIds);
    case "reject":
      return new Set();
    case "review":
      return new Set(
        decision.hunks
          .filter((hunk) => hunk.decision === "accept")
          .map((hunk) => hunk.hunkId)
      );
    default:
      return decision satisfies never;
  }
};

/**
 * What the reviewer said beyond accept/reject: comments on rejected (or
 * accepted) hunks and on lines. The SDK only passes a reason along with a
 * denial, so a partly applied change carries it in its own result.
 */
export const reviewFeedback = (
  decision: ApprovalDecision | undefined
): string | undefined => {
  if (decision?.decision !== "review") {
    return;
  }
  const lines = [
    ...decision.hunks.flatMap((hunk) =>
      hunk.comment
        ? [
            `Hunk ${hunk.hunkId} (${hunk.decision === "accept" ? "accepted" : "rejected"}): ${hunk.comment}`,
          ]
        : []
    ),
    ...decision.comments.map(
      (comment) => `${comment.path}:${comment.line}: ${comment.text}`
    ),
  ];
  return lines.length > 0 ? lines.join("\n") : undefined;
};

/** Applies a write or edit, honouring a per-hunk review. */
export const applySandboxChange = async (
  sandbox: ToolSandbox,
  change: ChangeInput,
  review: Review | undefined
): Promise<FileChangeOutput> => {
  const planned = await planChange(sandbox, change);
  if (!planned.ok) {
    return failure(planned.error);
  }
  const { after, before, path, target } = planned.value;
  // After an approval, the file must be the one the reviewer saw: the user
  // may have edited it in the Files panel while the change waited.
  const reviewedHash = review?.proposed && baseHashOf(review.proposed);
  if (reviewedHash && reviewedHash !== (await contentHash(before))) {
    return failure(
      `${path} was edited while this change waited for approval, so it wasn't applied. Read the file again and redo the change on its current contents.`
    );
  }
  const edit = await proposalFor(planned.value);
  const stale = failure(
    `${path} changed since the edit was reviewed; read it again and retry`
  );
  if (review?.proposed && review.proposed.patch !== edit?.patch) {
    return stale;
  }
  if (edit === null) {
    return { path, status: "unchanged" };
  }
  const ids = edit.hunks.map((hunk) => hunk.hunkId);
  const accepted = acceptedHunks(ids, review?.decision);
  const applied = ids.filter((id) => accepted.has(id));
  const rejected = ids.filter((id) => !accepted.has(id));

  let next: Result<string, unknown> = ok(after);
  if (rejected.length > 0) {
    next = applyReview(
      before,
      edit,
      applied.map((hunkId) => ({ decision: "accept" as const, hunkId }))
    );
  }
  if (!next.ok) {
    return stale;
  }
  if (applied.length > 0) {
    const written = await sandbox.writeFile(target, next.value);
    if (!written.ok) {
      return failure(describeError(written.error));
    }
  }
  const feedback = reviewFeedback(review?.decision);
  return {
    applied,
    edit,
    ...(feedback ? { feedback } : {}),
    rejected,
    status: "changed",
  };
};

/**
 * A `write` or `edit` call: applies the change under its review, then tells
 * `onChanged` if any of it landed.
 */
export const changeFile = async (
  { toolCallId, workspace }: SandboxToolContext,
  change: ChangeInput
): Promise<FileChangeOutput> => {
  const output = await applySandboxChange(
    workspace.sandbox,
    change,
    await workspace.reviewFor?.(toolCallId)
  );
  if (output.status === "changed" && output.applied.length > 0) {
    await workspace.onChanged?.(change.input.path);
  }
  return output;
};
