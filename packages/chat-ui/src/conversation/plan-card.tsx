"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import type { ArtifactId } from "@workspace/contract/schemas/common";
import { CheckIcon, FileTextIcon, PencilIcon, XIcon } from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import { createContext, type ReactNode, useCallback, useContext } from "react";

import type { PlanApprovalRef, PlanRef } from "../model/plan";
import { useConversationActions } from "./actions";

// Plan mode's card (106): the plan a planning run wrote, saved as an
// artifact, with what to do next. Approve starts a normal run carrying the
// plan, Edit opens it in the panel's editor, Discard sets it aside. A plan
// a later message approved, or one set aside, keeps only its title.

export interface PlanStatus {
  /** Plans a message on this branch approved. */
  readonly approved: ReadonlySet<ArtifactId>;
  /** A run is going: approving now would queue behind it, so wait. */
  readonly busy: boolean;
  /** Plans set aside in this visit. */
  readonly discarded: ReadonlySet<ArtifactId>;
}

const NO_PLANS: PlanStatus = {
  approved: new Set(),
  busy: false,
  discarded: new Set(),
};

// A context of its own, not the actions': rows are memoised by message, and
// a card must still change when a later message approves its plan.
const PlanStatusContext = createContext<PlanStatus>(NO_PLANS);

export function PlanStatusProvider({
  children,
  value,
}: {
  readonly children: ReactNode;
  readonly value: PlanStatus;
}) {
  return (
    <PlanStatusContext.Provider value={value}>
      {children}
    </PlanStatusContext.Provider>
  );
}

function PlanState({ plan }: { readonly plan: PlanRef }) {
  const { approved, discarded } = useContext(PlanStatusContext);
  if (approved.has(plan.artifactId)) {
    return <Trans>Plan · Approved</Trans>;
  }
  if (discarded.has(plan.artifactId)) {
    return <Trans>Plan · Set aside</Trans>;
  }
  return <Trans>Plan · Waiting for your approval</Trans>;
}

export function PlanCard({ plan }: { readonly plan: PlanRef }) {
  const { t } = useLingui();
  const { onApprovePlan, onDiscardPlan, onEditPlan, onOpenArtifact } =
    useConversationActions();
  const { approved, busy, discarded } = useContext(PlanStatusContext);
  const open = useCallback(
    () =>
      onOpenArtifact?.({
        artifactId: plan.artifactId,
        kind: "markdown",
        title: plan.title,
        type: "artifact-ref",
        versionId: plan.versionId,
      }),
    [onOpenArtifact, plan]
  );
  const approve = useCallback(
    () => onApprovePlan?.(plan),
    [onApprovePlan, plan]
  );
  // Edit opens the plan in the panel first, then swaps its view for the editor.
  const edit = useCallback(() => {
    open();
    onEditPlan?.(plan);
  }, [onEditPlan, open, plan]);
  const discard = useCallback(
    () => onDiscardPlan?.(plan),
    [onDiscardPlan, plan]
  );
  const settled =
    approved.has(plan.artifactId) || discarded.has(plan.artifactId);
  const actionable = !settled && onApprovePlan !== undefined;
  return (
    <section
      aria-label={t`Plan: ${plan.title}`}
      className="flex w-full max-w-md flex-col gap-3 rounded-lg border p-3"
      data-slot="plan-card"
    >
      <button
        aria-label={t`Open plan: ${plan.title}`}
        className="flex min-w-0 items-center gap-3 rounded-md text-start outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none"
        disabled={!onOpenArtifact}
        onClick={open}
        type="button"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
          <FileTextIcon aria-hidden className="size-4" />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium text-sm">{plan.title}</span>
          <span className="text-muted-foreground text-xs">
            <PlanState plan={plan} />
          </span>
        </span>
      </button>
      {actionable ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={busy} onClick={approve} size="sm">
            <CheckIcon aria-hidden />
            <Trans>Approve</Trans>
          </Button>
          {onEditPlan ? (
            <Button onClick={edit} size="sm" variant="outline">
              <PencilIcon aria-hidden />
              <Trans>Edit</Trans>
            </Button>
          ) : null}
          {onDiscardPlan ? (
            <Button onClick={discard} size="sm" variant="ghost">
              <XIcon aria-hidden />
              <Trans>Discard</Trans>
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** The note on a message that approved a plan. */
export function PlanApprovalNote({
  approval,
}: {
  readonly approval: PlanApprovalRef;
}) {
  return (
    <p
      className="flex items-center gap-1.5 text-muted-foreground text-xs"
      data-artifact-id={approval.artifactId}
    >
      <CheckIcon aria-hidden className="size-3.5" />
      <Trans>Approved the plan</Trans>
    </p>
  );
}
