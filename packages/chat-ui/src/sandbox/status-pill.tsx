"use client";

import { useLingui } from "@lingui/react/macro";
import type {
  SandboxRecord,
  SandboxStatus,
} from "@workspace/contract/schemas/sandbox";
import {
  CircleCheckIcon,
  CircleIcon,
  CircleXIcon,
  ClockIcon,
  LoaderCircleIcon,
  LockIcon,
  TriangleAlertIcon,
} from "@workspace/icons";
import { Badge } from "@workspace/ui/components/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";

// The sandbox's state and how strongly it's isolated, at a glance (D7). Plain
// containers get a warning: they're weaker than gVisor or a microVM.

const StateIcon = ({ state }: { readonly state: SandboxStatus["state"] }) => {
  switch (state) {
    case "provisioning":
      return (
        <LoaderCircleIcon
          aria-hidden
          className="animate-spin"
          data-icon="inline-start"
        />
      );
    case "ready":
      return <CircleCheckIcon aria-hidden data-icon="inline-start" />;
    case "stopped":
      return <ClockIcon aria-hidden data-icon="inline-start" />;
    case "failed":
      return <CircleXIcon aria-hidden data-icon="inline-start" />;
    case "destroyed":
      return <CircleIcon aria-hidden data-icon="inline-start" />;
    default:
      return state satisfies never;
  }
};

export function SandboxStatusPill({
  sandbox,
}: {
  readonly sandbox: Pick<SandboxRecord, "isolation" | "status">;
}) {
  const { t } = useLingui();
  const { isolation, status } = sandbox;

  const stateLabel = {
    destroyed: t`Destroyed`,
    failed: t`Failed`,
    provisioning: t`Starting`,
    ready: t`Ready`,
    stopped: t`Stopped`,
  }[status.state];

  const isolationLabel = {
    container: t`Container`,
    gvisor: t`gVisor`,
    none: t`Local`,
    simulated: t`Simulated`,
    vm: t`MicroVM`,
  }[isolation];

  const isolationHelp = {
    container: t`Runs in a plain Docker container. gVisor isn't available on this host, so isolation is weaker.`,
    gvisor: t`Runs in a container under gVisor, which intercepts system calls before they reach the host.`,
    none: t`Runs directly on this computer.`,
    simulated: t`A simulated shell with an in-memory filesystem. Nothing runs on a real machine.`,
    vm: t`Runs in a remote microVM.`,
  }[isolation];

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <Badge
        aria-live="polite"
        variant={status.state === "failed" ? "destructive" : "secondary"}
      >
        <StateIcon state={status.state} />
        {stateLabel}
      </Badge>
      <Tooltip>
        <TooltipTrigger
          render={
            <Badge
              aria-label={t`Isolation: ${isolationLabel}. ${isolationHelp}`}
              tabIndex={0}
              variant="outline"
            />
          }
        >
          {isolation === "container" ? (
            <TriangleAlertIcon aria-hidden data-icon="inline-start" />
          ) : (
            <LockIcon aria-hidden data-icon="inline-start" />
          )}
          {isolationLabel}
        </TooltipTrigger>
        <TooltipContent className="max-w-64">{isolationHelp}</TooltipContent>
      </Tooltip>
    </div>
  );
}
