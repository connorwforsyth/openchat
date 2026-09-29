"use client";

import { useLingui } from "@lingui/react/macro";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { lazy, Suspense } from "react";

import type { WorkspacePanelProps } from "./workspace-panel";

// The panel behind a dynamic import (D27): the file tree, the editor, code
// views and artifact previews load the first time a chat opens its
// workspace, not with the chat.

const WorkspacePanel = lazy(() =>
  import("./workspace-panel").then((module) => ({
    default: module.WorkspacePanel,
  }))
);

const PanelFallback = () => {
  const { t } = useLingui();
  return (
    <div
      aria-busy
      aria-label={t`Loading workspace`}
      className="flex h-full flex-col gap-2 bg-background p-3"
      role="status"
    >
      <Skeleton className="h-5 w-32" />
      <Skeleton className="flex-1" />
    </div>
  );
};

export function LazyWorkspacePanel(props: WorkspacePanelProps) {
  return (
    <Suspense fallback={<PanelFallback />}>
      <WorkspacePanel {...props} />
    </Suspense>
  );
}
