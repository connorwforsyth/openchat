"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { PanelRightIcon } from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";

/**
 * The header's one way into the right panel (D14): the chat's workspace,
 * with its Sandbox and Artifacts tabs. It replaced the sandbox pill and the
 * Artifacts button; the S and A keys still open a tab directly.
 */
export function WorkspaceToggle({
  onToggle,
  open,
}: {
  readonly onToggle: () => void;
  /** The panel is showing. */
  readonly open: boolean;
}) {
  const { t } = useLingui();
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={t`Workspace`}
            aria-pressed={open}
            className="aria-pressed:bg-muted"
            onClick={onToggle}
            size="icon-sm"
            variant="ghost"
          />
        }
      >
        <PanelRightIcon aria-hidden />
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <Trans>Workspace</Trans>
      </TooltipContent>
    </Tooltip>
  );
}
