"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { nextNominal } from "@workspace/ai/schedules/recurrence";
import {
  resolveWhen,
  scheduleTaskInputSchema,
} from "@workspace/ai/schedules/tool";
import type { JsonValue } from "@workspace/contract/schemas/common";
import { ClockIcon } from "@workspace/icons";
import { Badge } from "@workspace/ui/components/badge";
import { useMemo } from "react";

import { formatAt, useRecurrenceText } from "./schedule-text";

// A Dot's `schedule_task` call as a Proposed schedule card (183): the model
// proposes, the owner applies (the call's approval). It says the task, when
// it runs in plain words, the first run, and when it'll tell you. Once
// applied it reads "Scheduled"; rejected, "Not scheduled".

export type ProposalState = "proposed" | "scheduled" | "dismissed" | "failed";

export function ScheduleProposal({
  input,
  state,
}: {
  readonly input: JsonValue;
  readonly state: ProposalState;
}) {
  const { i18n } = useLingui();
  const say = useRecurrenceText();
  const parsed = scheduleTaskInputSchema.safeParse(input);
  const recurrence = useMemo(() => {
    if (!parsed.success) {
      return null;
    }
    const read = resolveWhen(
      parsed.data.when,
      parsed.data.timezone,
      new Date()
    );
    return read.ok ? read.value : null;
  }, [parsed.success, parsed.data]);
  if (!parsed.success) {
    return null;
  }
  const { notify, prompt, timezone, title, when } = parsed.data;
  const first = recurrence ? nextNominal(recurrence, new Date()) : null;
  const firstAt =
    first?.ok && first.value
      ? formatAt(i18n.locale, first.value.toISOString(), timezone)
      : null;
  const whenText = recurrence ? say(recurrence) : when;
  return (
    <div
      className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3"
      data-state={state}
    >
      <div className="flex items-center gap-2">
        <ClockIcon aria-hidden className="size-4 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-medium text-sm">
          {title}
        </span>
        {state === "proposed" ? (
          <Badge variant="outline">
            <Trans>Proposed</Trans>
          </Badge>
        ) : null}
        {state === "scheduled" ? (
          <Badge variant="secondary">
            <Trans>Scheduled</Trans>
          </Badge>
        ) : null}
        {state === "dismissed" || state === "failed" ? (
          <Badge variant="outline">
            <Trans>Not scheduled</Trans>
          </Badge>
        ) : null}
      </div>
      <p className="line-clamp-3 text-sm">{prompt}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
        <dt className="text-muted-foreground">
          <Trans>When</Trans>
        </dt>
        <dd>
          {whenText}
          {recurrence ? null : (
            <span className="ms-1 text-destructive">
              <Trans>(couldn't read this time)</Trans>
            </span>
          )}
        </dd>
        {firstAt ? (
          <>
            <dt className="text-muted-foreground">
              <Trans>First run</Trans>
            </dt>
            <dd>
              {firstAt} · {timezone}
            </dd>
          </>
        ) : null}
        <dt className="text-muted-foreground">
          <Trans>Tells you</Trans>
        </dt>
        <dd>
          {notify === "important" ? (
            <Trans>Only when it needs you</Trans>
          ) : null}
          {notify === "all" ? <Trans>Every run with news</Trans> : null}
          {notify === "failures" ? <Trans>Only if a run fails</Trans> : null}
          {notify === "none" ? <Trans>Never</Trans> : null}
        </dd>
      </dl>
    </div>
  );
}
