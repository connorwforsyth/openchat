"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { XIcon } from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import type { ReactNode } from "react";

// The right panel's frame (ticket 009, 060): a title bar with Close over the
// chat's Workspace panel. It used to hold Sandbox and Artifacts tabs; the
// Workspace panel lists both now, so there's one panel and no tabs.

export interface RightPanelProps {
  readonly children: ReactNode;
  readonly onClose: () => void;
}

export function RightPanel({ children, onClose }: RightPanelProps) {
  const { t } = useLingui();
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <h2 className="font-medium text-sm">
          <Trans>Workspace</Trans>
        </h2>
        <Button
          aria-label={t`Close panel`}
          className="ms-auto"
          onClick={onClose}
          size="icon-sm"
          variant="ghost"
        >
          <XIcon aria-hidden />
        </Button>
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
