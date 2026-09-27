"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import type { ApprovalDecision } from "@workspace/contract/schemas/message-parts";
import type { ProposedEdit } from "@workspace/contract/schemas/runs";
import { CheckIcon, ClockIcon, XIcon } from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import { Textarea } from "@workspace/ui/components/textarea";
import { type ChangeEvent, useCallback, useId, useState } from "react";

import { addEditReview, type EditReviews } from "../model/approval";
import { LazyDiffView } from "./lazy";

// A tool call waiting on a person (D16). Plain tools get Approve / Reject
// (with an optional reason for the agent). Write and edit tools show each
// proposed file as a diff with per-hunk accept/reject; once every file is
// reviewed, the combined review goes back as one decision.

export interface ApprovalCardProps {
  readonly edits: readonly ProposedEdit[];
  readonly onDecide: (decision: ApprovalDecision) => void;
  readonly toolName: string;
}

export function ApprovalCard({ edits, onDecide, toolName }: ApprovalCardProps) {
  const { t } = useLingui();
  const reasonId = useId();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [reviews, setReviews] = useState<EditReviews>({});
  const [sent, setSent] = useState(false);

  const decide = useCallback(
    (decision: ApprovalDecision) => {
      setSent(true);
      onDecide(decision);
    },
    [onDecide]
  );
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

  if (sent) {
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
