"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { useRelativeText } from "@workspace/chat-ui/conversation/schedule-text";
import type { ConversationId } from "@workspace/contract/schemas/common";
import type { ConversationSchedule } from "@workspace/contract/schemas/schedules";
import { ClockIcon } from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import { useCallback, useState } from "react";

import { useApi } from "@/app/(app)/_shared/api";
import { routes } from "@/lib/routes";

import { ScheduleEditor } from "./schedule-editor";

// The chat header's schedule (183): "Next run in 3 hours" when a task posts
// into this chat (it opens the schedules page), otherwise a clock that
// schedules one here.

export function ChatSchedule({
  conversationId,
  isDot,
  schedule,
}: {
  readonly conversationId: ConversationId;
  /** This chat is the owner's Dot: new tasks target the Dot. */
  readonly isDot: boolean;
  readonly schedule: ConversationSchedule | null | undefined;
}) {
  const { t } = useLingui();
  const { query } = useApi();
  const relative = useRelativeText();
  const dots = useQuery(query.dots.list.queryOptions({ input: {} }));
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
        <span aria-hidden data-icon="inline-start">
          {schedule.emoji}
        </span>
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
          chatId={isDot ? null : conversationId}
          hasDot={(dots.data?.length ?? 0) > 0}
          onOpenChange={setOpen}
          open
          seed={{
            prompt: "",
            target: isDot
              ? { kind: "dot" }
              : { conversationId, kind: "conversation" },
            title: "",
            when: "",
          }}
        />
      ) : null}
    </>
  );
}
