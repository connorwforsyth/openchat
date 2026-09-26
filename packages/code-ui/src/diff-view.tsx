"use client";

import { Plural, Trans, useLingui } from "@lingui/react/macro";
import type { DiffLineAnnotation } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import type { ApprovalDecision } from "@workspace/contract/schemas/message-parts";
import type { ProposedEdit } from "@workspace/contract/schemas/runs";
import { CheckIcon, TriangleAlertIcon, XIcon } from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import { Textarea } from "@workspace/ui/components/textarea";
import { cn } from "@workspace/ui/lib/utils";
import {
  type ChangeEvent,
  type ReactNode,
  useCallback,
  useMemo,
  useReducer,
  useState,
} from "react";

import { CodeHeader } from "./code-header";
import type { ReviewHunk } from "./review/patch";
import { parseProposedEdit } from "./review/patch";
import {
  type HunkReview,
  initialReviewState,
  type ReviewAction,
  reviewReducer,
  summarizeReview,
  toApprovalDecision,
} from "./review/review-state";
import { codeThemeNames } from "./theme/code-theme";
import { diffsHostStyle } from "./theme/host-styles";
import { registerCodeThemes } from "./theme/register";
import { useCodeThemeType } from "./theme/use-code-theme-type";

registerCodeThemes();

export type DiffStyle = "split" | "unified";

/** An annotation on the diff: our hunk controls, or the caller's own. */
type DiffMeta<Meta> =
  | { readonly hunkId: string; readonly kind: "hunk" }
  | { readonly annotation: DiffLineAnnotation<Meta>; readonly kind: "custom" };

export interface DiffViewProps<Meta = undefined> {
  /** Extra line annotations (comments, pins) from the caller. */
  readonly annotations?: readonly DiffLineAnnotation<Meta>[];
  readonly className?: string;
  /** The initial layout; the header toggles it. */
  readonly defaultDiffStyle?: DiffStyle;
  readonly edit: ProposedEdit;
  /**
   * Called with the contract's `review` decision when the user submits a
   * review where every hunk is decided. Omit for a read-only diff.
   */
  readonly onSubmitReview?: (decision: ApprovalDecision) => void;
  readonly renderAnnotation?: (
    annotation: DiffLineAnnotation<Meta>
  ) => ReactNode;
}

/**
 * A proposed edit as a split or unified diff. With `onSubmitReview`, each hunk
 * gets accept and reject controls (and an optional comment when rejected), and
 * submitting emits the contract's per-hunk review decision (PLAN.md D16).
 */
export function DiffView<Meta = undefined>({
  annotations,
  className,
  defaultDiffStyle = "unified",
  edit,
  onSubmitReview,
  renderAnnotation,
}: DiffViewProps<Meta>) {
  const parsed = useMemo(() => parseProposedEdit(edit), [edit]);

  if (!parsed.ok) {
    // Degrade to the raw patch rather than failing the whole message.
    return (
      <div className={cn("overflow-hidden rounded-lg border", className)}>
        <CodeHeader
          meta={
            <span className="flex items-center gap-1 text-destructive">
              <TriangleAlertIcon aria-hidden className="size-3.5" />
              <Trans>This change couldn't be displayed as a diff.</Trans>
            </span>
          }
          path={edit.path}
        />
        <pre className="overflow-x-auto p-3 font-mono text-xs">
          {edit.patch}
        </pre>
      </div>
    );
  }

  return (
    <ParsedDiffView
      annotations={annotations}
      className={className}
      defaultDiffStyle={defaultDiffStyle}
      fileDiff={parsed.value.fileDiff}
      hunks={parsed.value.hunks}
      onSubmitReview={onSubmitReview}
      path={parsed.value.path}
      renderAnnotation={renderAnnotation}
    />
  );
}

interface ParsedDiffViewProps<Meta>
  extends Omit<DiffViewProps<Meta>, "edit" | "defaultDiffStyle"> {
  readonly defaultDiffStyle: DiffStyle;
  readonly fileDiff: Parameters<typeof FileDiff>[0]["fileDiff"];
  readonly hunks: readonly ReviewHunk[];
  readonly path: string;
}

function ParsedDiffView<Meta>({
  annotations,
  className,
  defaultDiffStyle,
  fileDiff,
  hunks,
  onSubmitReview,
  path,
  renderAnnotation,
}: ParsedDiffViewProps<Meta>) {
  const { themeType } = useCodeThemeType();
  const [diffStyle, setDiffStyle] = useState(defaultDiffStyle);
  const [review, dispatch] = useReducer(
    reviewReducer,
    hunks.map((hunk) => hunk.hunkId),
    initialReviewState
  );
  const reviewing = onSubmitReview !== undefined;

  const lineAnnotations = useMemo(
    (): DiffLineAnnotation<DiffMeta<Meta>>[] => [
      ...(reviewing
        ? hunks.map(
            (hunk): DiffLineAnnotation<DiffMeta<Meta>> => ({
              ...hunk.anchor,
              metadata: { hunkId: hunk.hunkId, kind: "hunk" },
            })
          )
        : []),
      ...(annotations ?? []).map(
        (annotation): DiffLineAnnotation<DiffMeta<Meta>> => ({
          lineNumber: annotation.lineNumber,
          metadata: { annotation, kind: "custom" },
          side: annotation.side,
        })
      ),
    ],
    [annotations, hunks, reviewing]
  );

  const options = useMemo(
    () => ({
      diffStyle,
      disableFileHeader: true,
      hunkSeparators: "line-info" as const,
      lineDiffType: "word" as const,
      theme: codeThemeNames,
      themeType,
    }),
    [diffStyle, themeType]
  );

  const additions = fileDiff.hunks.reduce(
    (sum, hunk) => sum + hunk.additionLines,
    0
  );
  const deletions = fileDiff.hunks.reduce(
    (sum, hunk) => sum + hunk.deletionLines,
    0
  );

  const renderLineAnnotation = useCallback(
    (annotation: DiffLineAnnotation<DiffMeta<Meta>>) => {
      const meta = annotation.metadata;
      if (meta.kind === "custom") {
        return renderAnnotation?.(meta.annotation);
      }
      const state = review.reviews[meta.hunkId];
      return state ? (
        <HunkControls
          dispatch={dispatch}
          hunkId={meta.hunkId}
          number={review.order.indexOf(meta.hunkId) + 1}
          review={state}
        />
      ) : null;
    },
    [renderAnnotation, review]
  );

  const submit = useCallback(() => {
    const decision = toApprovalDecision(review);
    if (decision.ok) {
      onSubmitReview?.(decision.value);
    }
  }, [onSubmitReview, review]);

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border bg-background",
        className
      )}
    >
      <CodeHeader
        actions={<DiffStyleToggle onChange={setDiffStyle} value={diffStyle} />}
        meta={<ChangeCounts additions={additions} deletions={deletions} />}
        path={path}
      />
      <FileDiff
        fileDiff={fileDiff}
        lineAnnotations={lineAnnotations}
        options={options}
        renderAnnotation={renderLineAnnotation}
        style={diffsHostStyle}
      />
      {reviewing ? (
        <ReviewFooter
          dispatch={dispatch}
          onSubmit={submit}
          summary={summarizeReview(review)}
        />
      ) : null}
    </div>
  );
}

function ChangeCounts({
  additions,
  deletions,
}: {
  readonly additions: number;
  readonly deletions: number;
}) {
  return (
    <>
      <span className="text-foreground">
        <span aria-hidden>+{additions}</span>
        <span className="sr-only">
          <Plural one="# line added" other="# lines added" value={additions} />
        </span>
      </span>
      <span className="text-destructive">
        <span aria-hidden>−{deletions}</span>
        <span className="sr-only">
          <Plural
            one="# line removed"
            other="# lines removed"
            value={deletions}
          />
        </span>
      </span>
    </>
  );
}

function DiffStyleToggle({
  onChange,
  value,
}: {
  readonly onChange: (value: DiffStyle) => void;
  readonly value: DiffStyle;
}) {
  const { t } = useLingui();
  const showUnified = useCallback(() => onChange("unified"), [onChange]);
  const showSplit = useCallback(() => onChange("split"), [onChange]);
  return (
    <fieldset
      aria-label={t`Diff layout`}
      className="flex items-center gap-0.5 rounded-md border p-0.5"
    >
      <Button
        aria-pressed={value === "unified"}
        onClick={showUnified}
        size="xs"
        variant={value === "unified" ? "secondary" : "ghost"}
      >
        <Trans>Unified</Trans>
      </Button>
      <Button
        aria-pressed={value === "split"}
        onClick={showSplit}
        size="xs"
        variant={value === "split" ? "secondary" : "ghost"}
      >
        <Trans>Split</Trans>
      </Button>
    </fieldset>
  );
}

function HunkStatus({
  decision,
  number,
}: {
  readonly decision: HunkReview["decision"];
  readonly number: number;
}) {
  switch (decision) {
    case "accept":
      return <Trans>Change {number} accepted</Trans>;
    case "reject":
      return <Trans>Change {number} rejected</Trans>;
    case "pending":
      return <Trans>Change {number}</Trans>;
    default: {
      const unreachable: never = decision;
      return unreachable;
    }
  }
}

function HunkControls({
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
  const { t } = useLingui();
  // Pressing the active decision again undoes it.
  const toggleAccept = useCallback(
    () =>
      dispatch({
        decision: review.decision === "accept" ? "pending" : "accept",
        hunkId,
        type: "decide",
      }),
    [dispatch, hunkId, review.decision]
  );
  const toggleReject = useCallback(
    () =>
      dispatch({
        decision: review.decision === "reject" ? "pending" : "reject",
        hunkId,
        type: "decide",
      }),
    [dispatch, hunkId, review.decision]
  );
  const comment = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) =>
      dispatch({ comment: event.target.value, hunkId, type: "comment" }),
    [dispatch, hunkId]
  );

  return (
    <div
      className={cn(
        "flex flex-col gap-2 border-y px-3 py-2 font-sans text-sm",
        review.decision === "accept" && "bg-muted/60",
        review.decision === "reject" && "bg-destructive/5"
      )}
      data-decision={review.decision}
      data-hunk-id={hunkId}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground text-xs">
          <HunkStatus decision={review.decision} number={number} />
        </span>
        <div className="ms-auto flex items-center gap-1.5">
          <Button
            aria-label={t`Accept change ${number}`}
            aria-pressed={review.decision === "accept"}
            onClick={toggleAccept}
            size="xs"
            variant={review.decision === "accept" ? "default" : "outline"}
          >
            <CheckIcon aria-hidden data-icon="inline-start" />
            <Trans>Accept</Trans>
          </Button>
          <Button
            aria-label={t`Reject change ${number}`}
            aria-pressed={review.decision === "reject"}
            onClick={toggleReject}
            size="xs"
            variant={review.decision === "reject" ? "destructive" : "outline"}
          >
            <XIcon aria-hidden data-icon="inline-start" />
            <Trans>Reject</Trans>
          </Button>
        </div>
      </div>
      {review.decision === "reject" ? (
        <Textarea
          aria-label={t`Comment for the agent on change ${number}`}
          className="min-h-12 text-sm"
          maxLength={4000}
          onChange={comment}
          placeholder={t`Optional: tell the agent why`}
          value={review.comment}
        />
      ) : null}
    </div>
  );
}

function ReviewFooter({
  dispatch,
  onSubmit,
  summary,
}: {
  readonly dispatch: (action: ReviewAction) => void;
  readonly onSubmit: () => void;
  readonly summary: ReturnType<typeof summarizeReview>;
}) {
  const { accepted, pending, rejected } = summary;
  const rejectRest = useCallback(
    () => dispatch({ decision: "reject", type: "decide-rest" }),
    [dispatch]
  );
  const acceptRest = useCallback(
    () => dispatch({ decision: "accept", type: "decide-rest" }),
    [dispatch]
  );
  return (
    <div className="flex flex-wrap items-center gap-2 border-t bg-muted/40 px-3 py-2 text-sm">
      <span aria-live="polite" className="text-muted-foreground text-xs">
        <Trans>
          {accepted} accepted, {rejected} rejected,{" "}
          <Plural one="# to review" other="# to review" value={pending} />
        </Trans>
      </span>
      <div className="ms-auto flex items-center gap-1.5">
        <Button
          disabled={pending === 0}
          onClick={rejectRest}
          size="sm"
          variant="ghost"
        >
          <Trans>Reject the rest</Trans>
        </Button>
        <Button
          disabled={pending === 0}
          onClick={acceptRest}
          size="sm"
          variant="outline"
        >
          <Trans>Accept the rest</Trans>
        </Button>
        <Button disabled={pending > 0} onClick={onSubmit} size="sm">
          <Trans>Submit review</Trans>
        </Button>
      </div>
    </div>
  );
}
