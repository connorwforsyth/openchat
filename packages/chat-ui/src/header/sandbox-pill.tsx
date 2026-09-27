"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import type { SandboxRecord } from "@workspace/contract/schemas/sandbox";
import { TerminalIcon } from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";

import { ShortcutHint } from "../shortcuts/shortcut-hint";

type SandboxState = SandboxRecord["status"]["state"] | "none";

/**
 * The sandbox's state at a glance in the header (ticket 009); clicking opens
 * the Sandbox panel. The dot's shape and the label carry the state, colour
 * only reinforces it.
 */
export function SandboxPill({
  onOpen,
  open,
  sandbox,
}: {
  readonly onOpen: () => void;
  /** The Sandbox panel is showing. */
  readonly open: boolean;
  readonly sandbox: Pick<SandboxRecord, "status"> | null;
}) {
  const { t } = useLingui();
  const state: SandboxState = sandbox?.status.state ?? "none";
  const label = {
    destroyed: t`Destroyed`,
    failed: t`Failed`,
    none: t`No sandbox`,
    provisioning: t`Starting`,
    ready: t`Ready`,
    stopped: t`Stopped`,
  }[state];
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={t`Sandbox: ${label}`}
            aria-pressed={open}
            className="rounded-full text-muted-foreground"
            onClick={onOpen}
            size="sm"
            variant="ghost"
          />
        }
      >
        <span
          aria-hidden
          className={cn(
            "inline-flex size-2 shrink-0 rounded-full",
            state === "ready" && "bg-primary",
            state === "provisioning" && "bg-primary motion-safe:animate-pulse",
            state === "failed" && "bg-destructive",
            (state === "stopped" ||
              state === "destroyed" ||
              state === "none") &&
              "border border-muted-foreground"
          )}
        />
        <TerminalIcon aria-hidden className="lg:hidden" />
        <span className="hidden lg:inline">{label}</span>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <Trans>Sandbox panel</Trans>
        <ShortcutHint id="panel.sandbox" />
      </TooltipContent>
    </Tooltip>
  );
}
