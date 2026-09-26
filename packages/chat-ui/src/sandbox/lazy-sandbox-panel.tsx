"use client";

import { useLingui } from "@lingui/react/macro";
import { lazy, Suspense } from "react";

import type { SandboxPanelProps } from "./sandbox-panel";

// The panel behind a dynamic import (D27): the terminal, file tree and code
// views load the first time a chat opens its sandbox, not with the chat.

const SandboxPanel = lazy(() =>
  import("./sandbox-panel").then((module) => ({ default: module.SandboxPanel }))
);

const PanelFallback = () => {
  const { t } = useLingui();
  return (
    <div
      aria-busy
      aria-label={t`Loading sandbox`}
      className="flex h-full flex-col gap-2 bg-background p-3"
      role="status"
    >
      <div className="h-5 w-32 animate-pulse rounded-md bg-muted" />
      <div className="flex-1 animate-pulse rounded-md bg-muted/40" />
    </div>
  );
};

export function LazySandboxPanel(props: SandboxPanelProps) {
  return (
    <Suspense fallback={<PanelFallback />}>
      <SandboxPanel {...props} />
    </Suspense>
  );
}
