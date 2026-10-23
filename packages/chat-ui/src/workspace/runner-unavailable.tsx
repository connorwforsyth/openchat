"use client";

import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  RUNNER_UNAVAILABLE,
  type RunnerUnavailableReason,
} from "@workspace/sandbox/runner/unavailable";
import { CodeBlockCopyButton } from "@workspace/ui/components/code-block";
import { cn } from "@workspace/ui/lib/utils";

// Why the sandbox runner can't serve, in the reader's language, and the
// command that fixes it, ready to copy. The reasons and commands are
// `@workspace/sandbox`'s table; only the wording lives here, keyed by it.

export const runnerUnavailableLabels: Readonly<
  Record<RunnerUnavailableReason, MessageDescriptor>
> = {
  desktop_image_missing: msg`The computer's desktop image isn't built on this Docker host.`,
  docker_unavailable: msg`The sandbox runner is up but can't reach Docker. Start Docker, then start the runner's services.`,
  not_configured: msg`Docker sandboxes aren't configured: set SANDBOX_RUNNER_TOKEN in .env and sandbox.docker in app.config.yaml.`,
  runner_error: msg`The sandbox runner answered with an error; its log says why.`,
  runner_token_missing: msg`The sandbox runner has no SANDBOX_RUNNER_TOKEN, so it refuses every call. Set it in .env, then recreate the runner.`,
  runner_unreachable: msg`The sandbox runner isn't running.`,
  token_rejected: msg`The sandbox runner rejected the app's SANDBOX_RUNNER_TOKEN: they differ. Use one value in .env, then recreate the runner.`,
};

export function RunnerUnavailableNotice({
  className,
  reason,
}: {
  readonly className?: string;
  readonly reason: RunnerUnavailableReason;
}) {
  const { i18n } = useLingui();
  const { command } = RUNNER_UNAVAILABLE[reason];
  return (
    <div
      className={cn("flex min-w-0 flex-col gap-1.5", className)}
      data-reason={reason}
      data-slot="runner-unavailable"
    >
      <p>{i18n._(runnerUnavailableLabels[reason])}</p>
      <p className="text-muted-foreground">
        <Trans>To fix it, run this from the repository:</Trans>
      </p>
      <div className="flex items-start gap-1 rounded-md border border-border bg-muted py-1 ps-2 pe-1">
        <code className="min-w-0 flex-1 select-all break-all py-0.5 font-mono text-foreground text-xs">
          {command}
        </code>
        <CodeBlockCopyButton value={command} />
      </div>
    </div>
  );
}
