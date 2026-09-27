"use client";

import { useLingui } from "@lingui/react/macro";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { lazy, Suspense } from "react";

import type { ArtifactsPanelProps } from "./artifacts-panel";

// The panel behind a dynamic import (D27): code views, diffs and previews
// load the first time a chat opens its artifacts, not with the chat.

const ArtifactsPanel = lazy(() =>
  import("./artifacts-panel").then((module) => ({
    default: module.ArtifactsPanel,
  }))
);

function PanelFallback() {
  const { t } = useLingui();
  return (
    <div
      aria-busy
      aria-label={t`Loading artifacts`}
      className="flex h-full flex-col gap-2 p-3"
      role="status"
    >
      <Skeleton className="h-5 w-32" />
      <Skeleton className="flex-1" />
    </div>
  );
}

export function LazyArtifactsPanel(props: ArtifactsPanelProps) {
  return (
    <Suspense fallback={<PanelFallback />}>
      <ArtifactsPanel {...props} />
    </Suspense>
  );
}
