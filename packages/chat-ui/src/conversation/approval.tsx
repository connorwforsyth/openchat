"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import type { ApprovalDecision } from "@workspace/contract/schemas/message-parts";
import type { ProposedEdit } from "@workspace/contract/schemas/runs";
import {
  CheckIcon,
  CircleAlertIcon,
  ClockIcon,
  RefreshCwIcon,
  XIcon,
} from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import { Textarea } from "@workspace/ui/components/textarea";
import { type ChangeEvent, useCallback, useId, useState } from "react";

import {
  addEditReview,
  type EditReviews,
  REPROPOSE_REASON,
} from "../model/approval";
import type { DecisionState } from "./approval-state";
import { LazyDiffView } from "./lazy";

// A tool call waiting on a person (D16). Plain tools get Approve / Reject
// (with an optional reason for the agent). Write and edit tools show each
// proposed file as a diff with per-hunk accept/reject; once every file is
// reviewed, the combined review goes back as one decision.

export interface ApprovalCardProps {
  readonly edits: readonly ProposedEdit[];
  readonly onDecide: (decision: ApprovalDecision) => void;
  /** Sends the decision that failed again. */
  readonly onRetry?: () => void;
  /**
   * The file changed since the change was proposed, so approving it can't
   * apply (the tool would refuse it): the card offers to ask the agent for
   * the change on the file as it is now instead.
   */
  readonly stale?: boolean;
  /**
   * The decision this page sent, until the server's copy shows the call
   * decided (072): kept by the host, by call, so it survives the card
   * remounting and a second click can't send another.
   */
  readonly state?: DecisionState;
  readonly toolName: string;
}

export function ApprovalCard({
  edits,
  onDecide,
  onRetry,
  stale = false,
  state,
  toolName,
}: ApprovalCardProps) {
  const { t } = useLingui();
  const reasonId = useId();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [reviews, setReviews] = useState<EditReviews>({});
  // Hides the buttons between the click and the host's state arriving, so
  // a double click sends once.
  const [clicked, setClicked] = useState(false);
  const failed = state?.status === "failed";

  const decide = useCallback(
    (decision: ApprovalDecision) => {
      setClicked(true);
      onDecide(decision);
    },
    [onDecide]
  );
  const retry = useCallback(() => {
    setClicked(true);
    onRetry?.();
  }, [onRetry]);
  const approve = useCallback(() => decide({ decision: "approve" }), [decide]);
  const startReject = useCallback(() => setRejecting(true), []);
  const cancelReject = useCallback(() => setRejecting(false), []);
  const onReason = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => setReason(event.target.value),
    []
  );
  const reject = useCallback(() => {
    const trimmed = reason.trim();
    decide(
      trimmed ? { decision: "reject", reason: trimmed } : { decision: "reject" }
    );
  }, [decide, reason]);

  const reviewFile = useCallback(
    (path: string, decision: ApprovalDecision) => {
      const next = addEditReview(edits, reviews, path, decision);
      setReviews(next.reviews);
      if (next.combined) {
        decide(next.combined);
      }
    },
    [decide, edits, reviews]
  );

  if (state?.status === "failed" && state.reason === "conflict") {
    return (
      <p className="flex items-center gap-2 text-sm" role="alert">
        <CircleAlertIcon aria-hidden className="size-4" />
        <Trans>
          This was already decided, in another tab or by someone else, or the
          answer stopped.
        </Trans>
      </p>
    );
  }
  if (state?.status === "sending" || (clicked && !failed)) {
    return (
      <p
        className="flex items-center gap-2 text-muted-foreground text-sm"
        role="status"
      >
        <ClockIcon aria-hidden className="size-4" />
        <Trans>Decision sent. Waiting for the agent…</Trans>
      </p>
    );
  }

  if (stale) {
    return (
      <StaleChange
        decide={decide}
        paths={edits.map((edit) => edit.path)}
        toolName={toolName}
      />
    );
  }

  const reviewed = Object.keys(reviews).length;
  return (
    <section
      aria-label={t`Approval needed for ${toolName}`}
      className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3"
    >
      <p className="font-medium text-sm">
        {edits.length > 0 ? (
          <Trans>
            The agent wants to change files. Review each change, or decide for
            all of them.
          </Trans>
        ) : (
          <Trans>The agent wants to run {toolName}.</Trans>
        )}
      </p>

      {edits.map((edit) => (
        <EditReview
          edit={edit}
          key={edit.path}
          onReview={reviewFile}
          reviewed={edit.path in reviews}
        />
      ))}
      {edits.length > 1 ? (
        <p aria-live="polite" className="text-muted-foreground text-xs">
          <Trans>
            {reviewed} of {edits.length} files reviewed
          </Trans>
        </p>
      ) : null}

      {failed ? (
        <div
          className="flex flex-wrap items-center justify-between gap-2 text-destructive text-sm"
          role="alert"
        >
          <span className="flex items-center gap-2">
            <CircleAlertIcon aria-hidden className="size-4" />
            <Trans>Your decision didn't reach the server.</Trans>
          </span>
          {onRetry ? (
            <Button onClick={retry} size="sm" variant="outline">
              <RefreshCwIcon aria-hidden data-icon="inline-start" />
              <Trans>Retry</Trans>
            </Button>
          ) : null}
        </div>
      ) : null}

      {rejecting ? (
        <div className="flex flex-col gap-2">
          <label className="text-sm" htmlFor={reasonId}>
            <Trans>Why? (optional, sent to the agent)</Trans>
          </label>
          <Textarea
            className="min-h-12 text-sm"
            id={reasonId}
            maxLength={4000}
            onChange={onReason}
            value={reason}
          />
          <div className="flex justify-end gap-2">
            <Button onClick={cancelReject} size="sm" variant="ghost">
              <Trans>Cancel</Trans>
            </Button>
            <Button onClick={reject} size="sm" variant="destructive">
              <XIcon aria-hidden data-icon="inline-start" />
              <Trans>Reject</Trans>
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap justify-end gap-2">
          <Button onClick={startReject} size="sm" variant="outline">
            <XIcon aria-hidden data-icon="inline-start" />
            {edits.length > 0 ? (
              <Trans>Reject all</Trans>
            ) : (
              <Trans>Reject</Trans>
            )}
          </Button>
          <Button onClick={approve} size="sm">
            <CheckIcon aria-hidden data-icon="inline-start" />
            {edits.length > 0 ? (
              <Trans>Approve all</Trans>
            ) : (
              <Trans>Approve</Trans>
            )}
          </Button>
        </div>
      )}
      <p className="text-muted-foreground text-xs">
        <Trans>
          Or send a new message: this change is skipped and the agent reads your
          message instead.
        </Trans>
      </p>
    </section>
  );
}

/**
 * A change proposed against a file that has changed since: it can't apply
 * as shown, so rather than approve it (and have the agent ask again after
 * a refusal) the person asks for it again on the file as it is, or rejects
 * it.
 */
function StaleChange({
  decide,
  paths,
  toolName,
}: {
  readonly decide: (decision: ApprovalDecision) => void;
  readonly paths: readonly string[];
  readonly toolName: string;
}) {
  const { t } = useLingui();
  const files = paths.join(", ");
  const repropose = useCallback(
    () => decide({ decision: "reject", reason: REPROPOSE_REASON }),
    [decide]
  );
  const reject = useCallback(() => decide({ decision: "reject" }), [decide]);
  return (
    <section
      aria-label={t`Approval needed for ${toolName}`}
      className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3"
    >
      <p className="flex items-start gap-2 text-sm" role="alert">
        <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
        <Trans>
          {files} changed after the agent proposed this, so the change can't be
          applied as shown.
        </Trans>
      </p>
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={reject} size="sm" variant="outline">
          <XIcon aria-hidden data-icon="inline-start" />
          <Trans>Reject</Trans>
        </Button>
        <Button onClick={repropose} size="sm">
          <RefreshCwIcon aria-hidden data-icon="inline-start" />
          <Trans>Ask for an updated change</Trans>
        </Button>
      </div>
    </section>
  );
}

function EditReview({
  edit,
  onReview,
  reviewed,
}: {
  readonly edit: ProposedEdit;
  readonly onReview: (path: string, decision: ApprovalDecision) => void;
  readonly reviewed: boolean;
}) {
  const submit = useCallback(
    (decision: ApprovalDecision) => onReview(edit.path, decision),
    [edit.path, onReview]
  );
  if (reviewed) {
    return (
      <p className="flex items-center gap-2 text-muted-foreground text-sm">
        <CheckIcon aria-hidden className="size-4" />
        <Trans>Reviewed {edit.path}</Trans>
      </p>
    );
  }
  return <LazyDiffView edit={edit} onSubmitReview={submit} />;
}
