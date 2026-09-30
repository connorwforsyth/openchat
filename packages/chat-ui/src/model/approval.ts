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

// A proposal is stamped with the SHA-256 of the file it was made from, in
// the patch's `---` header (056, `withBaseHash` in the sandbox tools). The
// workspace's `readFile` etag is the SHA-256 of the same bytes, so a
// pending change whose file was edited since (the Files panel, another
// tab) is caught before anyone approves a diff that can no longer apply
// (072, audit F12).

const BASE_HASH = /^--- [^\n]*\tsha256:([0-9a-f]{64})$/m;

/** SHA-256 of nothing: the base of a file the change creates. */
export const EMPTY_FILE_HASH =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

/** The hash a proposal was made from; `undefined` for one made before hashes. */
export const baseHashOf = (edit: ProposedEdit): string | undefined => {
  const header = edit.patch.indexOf("\n@@");
  return BASE_HASH.exec(
    header === -1 ? edit.patch : edit.patch.slice(0, header)
  )?.[1];
};

/**
 * Paths whose file no longer matches what a change was proposed against,
 * given each file's current etag (`null` when it doesn't exist). A file
 * not read yet, or a proposal without a hash, counts as unchanged.
 */
export const staleEdits = (
  edits: readonly ProposedEdit[],
  etags: ReadonlyMap<string, string | null>
): string[] =>
  edits.flatMap((edit) => {
    const base = baseHashOf(edit);
    const current = etags.get(edit.path);
    if (base === undefined || current === undefined) {
      return [];
    }
    return (current ?? EMPTY_FILE_HASH) === base ? [] : [edit.path];
  });

/**
 * What the agent is told when the person asks for the change again on the
 * file as it is now. For the model, not the person: it isn't translated.
 */
export const REPROPOSE_REASON =
  "The file changed after you proposed this, so it wasn't applied. Read it again and propose the change on its current contents.";
