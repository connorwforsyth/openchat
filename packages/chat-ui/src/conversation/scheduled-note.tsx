"use client";

import { Trans } from "@lingui/react/macro";
import { CircleAlertIcon, ClockIcon } from "@workspace/icons";
import { cn } from "@workspace/ui/lib/utils";

import type { RunReport, ScheduledTask } from "../model/scheduled";

// Scheduled runs in the transcript (173, 175): the label on a message a
// schedule sent, the one line an answer's report becomes, and the single
// muted line a quiet run folds into.

function TaskMark({ task }: { readonly task: ScheduledTask }) {
  return task.emoji ? (
    <span aria-hidden>{task.emoji}</span>
  ) : (
    <ClockIcon aria-hidden className="size-3.5" />
  );
}

/** "Sent by scheduled task · Morning brief", above the prompt. */
export function ScheduledLabel({ task }: { readonly task: ScheduledTask }) {
  const { title } = task;
  return (
    <p className="ms-auto flex items-center gap-1.5 text-muted-foreground text-xs">
      <TaskMark task={task} />
      <Trans>Sent by scheduled task · {title}</Trans>
    </p>
  );
}

/** What the run reported, as one line under its answer. */
export function ReportNote({ report }: { readonly report: RunReport }) {
  if (report.outcome === "update") {
    return null;
  }
  const attention = report.outcome === "needs_attention";
  return (
    <p
      className={cn(
        "flex items-center gap-1.5 text-xs",
        attention ? "font-medium text-foreground" : "text-muted-foreground"
      )}
    >
      {attention ? <CircleAlertIcon aria-hidden className="size-3.5" /> : null}
      {attention ? (
        <Trans>Needs your attention</Trans>
      ) : (
        <Trans>Nothing new</Trans>
      )}
    </p>
  );
}

/** A quiet run, folded: the task's name and that nothing changed. */
export function QuietRunNote({ task }: { readonly task: ScheduledTask }) {
  const { title } = task;
  return (
    <p className="flex items-center justify-center gap-1.5 text-muted-foreground text-xs">
      <TaskMark task={task} />
      <Trans>{title} ran · nothing new</Trans>
    </p>
  );
}
