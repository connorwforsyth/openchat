"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { useRelativeText } from "@workspace/chat-ui/conversation/schedule-text";
import type { ConversationSchedule } from "@workspace/contract/schemas/schedules";
import { ClockIcon } from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import { useCallback, useState } from "react";

import { routes } from "@/lib/routes";

import { ScheduleEditor } from "./schedule-editor";

// The Dot's header schedule (183): "Next run in 3 hours" when a task posts
// into the Dot's chat (it opens the schedules page), otherwise a clock that
// schedules one for the Dot. Other chats' headers have none.

export function ChatSchedule({
  schedule,
}: {
  readonly schedule: ConversationSchedule | null | undefined;
}) {
  const { t } = useLingui();
  const relative = useRelativeText();
  const [open, setOpen] = useState(false);
  const show = useCallback(() => setOpen(true), []);
  if (schedule) {
    const next =
      schedule.status === "active" ? relative(schedule.nextRunNominalAt) : null;
    const { title } = schedule;
    return (
      <Button
        nativeButton={false}
        render={<a href={routes.schedules} />}
        size="sm"
        title={t`Scheduled task: ${title}`}
        variant="ghost"
      >
        <ClockIcon data-icon="inline-start" />
        <span className="max-sm:sr-only">
          {next ? <Trans>Next run {next}</Trans> : <Trans>Paused</Trans>}
        </span>
      </Button>
    );
  }
  return (
    <>
      <Button
        aria-label={t`Schedule a task in this chat`}
        onClick={show}
        size="icon-sm"
        title={t`Schedule a task`}
        variant="ghost"
      >
        <ClockIcon />
      </Button>
      {open ? (
        <ScheduleEditor
          hasDot
          onOpenChange={setOpen}
          open
          seed={{ prompt: "", target: { kind: "dot" }, title: "", when: "" }}
        />
      ) : null}
    </>
  );
}
