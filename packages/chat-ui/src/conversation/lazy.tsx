"use client";

import { Trans } from "@lingui/react/macro";
import type { ProposedEdit } from "@workspace/contract/schemas/runs";
import { ReasoningIcon } from "@workspace/icons";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { type ComponentProps, lazy, Suspense } from "react";

import { PulseLabel } from "./pulse-label";

// Code-split pieces of a message (D27): reasoning views and diffs load the
// first time a message needs them, not with the conversation.

const ReasoningPart = lazy(() =>
  import("./reasoning-part").then((module) => ({
    default: module.ReasoningPart,
  }))
);

const DiffView = lazy(() =>
  import("@workspace/code-ui/diff-view").then((module) => ({
    default: module.DiffView,
  }))
);

export function LazyReasoning(props: ComponentProps<typeof ReasoningPart>) {
  return (
    <Suspense
      fallback={
        <p className="flex items-center gap-2 text-muted-foreground text-sm">
          <ReasoningIcon aria-hidden className="size-4" />
          {/* The same title the loaded row shows, so it doesn't change. */}
          {props.streaming ? (
            <PulseLabel>
              <Trans>Thinking…</Trans>
            </PulseLabel>
          ) : (
            <Trans>Reasoning</Trans>
          )}
        </p>
      }
    >
      <ReasoningPart {...props} />
    </Suspense>
  );
}

export function LazyDiffView(props: {
  readonly edit: ProposedEdit;
  readonly onSubmitReview?: ComponentProps<typeof DiffView>["onSubmitReview"];
}) {
  return (
    <Suspense fallback={<Skeleton className="h-40 w-full" />}>
      <DiffView {...props} />
    </Suspense>
  );
}
