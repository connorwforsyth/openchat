"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import {
  formatAt,
  useOutcomeText,
  useRecurrenceText,
  useTimingText,
} from "@workspace/chat-ui/conversation/schedule-text";
import type {
  Schedule,
  ScheduleRun,
  ScheduleRunOutcome,
} from "@workspace/contract/schemas/schedules";
import {
  PauseIcon,
  PencilIcon,
  PlayIcon,
  Trash2Icon,
  ZapIcon,
} from "@workspace/icons";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@workspace/ui/components/drawer";
import { Spinner } from "@workspace/ui/components/spinner";
import { useToastManager } from "@workspace/ui/components/toast";
import { cn } from "@workspace/ui/lib/utils";
import { useCallback, useState } from "react";
import { useApi } from "@/app/(app)/_shared/api";
import { ConfirmButton } from "@/app/(app)/_shared/confirm";
import { codeOf } from "@/app/(app)/_shared/query-state";
import { routes } from "@/lib/routes";

// Scheduled tasks as rows (183): what it does, when, where it posts, and
// "Last ran … · Next …", with Run now, Pause/Resume, Edit and Delete. A row
// opens its run history.

const RUNS_PAGE = 20;

const outcomeVariant = (
  outcome: ScheduleRunOutcome | null
): "default" | "secondary" | "destructive" | "outline" => {
  switch (outcome) {
    case "needs_attention":
      return "default";
    case "failed":
      return "destructive";
    case "update":
      return "secondary";
    default:
      return "outline";
  }
};

export function OutcomeBadge({
  outcome,
}: {
  readonly outcome: ScheduleRunOutcome | null;
}) {
  const say = useOutcomeText();
  return <Badge variant={outcomeVariant(outcome)}>{say(outcome)}</Badge>;
}

const useRefreshSchedules = () => {
  const { query } = useApi();
  const queryClient = useQueryClient();
  return useCallback(
    () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: query.schedules.key() }),
        queryClient.invalidateQueries({ queryKey: query.dots.key() }),
        queryClient.invalidateQueries({ queryKey: query.conversations.key() }),
      ]),
    [query, queryClient]
  );
};

function TargetText({ schedule }: { readonly schedule: Schedule }) {
  switch (schedule.target.kind) {
    case "dot":
      return <Trans>Your Dot</Trans>;
    case "conversation":
      return schedule.conversationId ? (
        <a
          className="underline-offset-2 hover:underline"
          href={routes.chat(schedule.conversationId)}
        >
          <Trans>A chat</Trans>
        </a>
      ) : (
        <Trans>A chat</Trans>
      );
    case "new_chat_each_run":
      return <Trans>New chat each run</Trans>;
    default:
      return schedule.target satisfies never;
  }
}

function RunItem({
  run,
  timezone,
}: {
  readonly run: ScheduleRun;
  readonly timezone: string;
}) {
  const { i18n } = useLingui();
  const at = formatAt(i18n.locale, run.createdAt, timezone);
  const started = run.outcome === "skipped" ? null : run;
  const skipReason = run.outcome === "skipped" ? run.skipReason : null;
  const href =
    run.conversationId && started ? routes.chat(run.conversationId) : null;
  return (
    <li className="flex flex-col gap-1 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <OutcomeBadge outcome={run.outcome} />
        <span className="text-muted-foreground">
          {run.trigger === "run_now" ? <Trans>Run now</Trans> : null}
          {run.trigger === "scheduled" && run.missedSlots > 0 ? (
            <Trans>Caught up {run.missedSlots} missed</Trans>
          ) : null}
          {skipReason === "cap" ? <Trans>Daily run limit reached</Trans> : null}
          {skipReason === "busy" ? <Trans>The chat was busy</Trans> : null}
          {skipReason === "missed" ? (
            <Trans>Missed while the server was down</Trans>
          ) : null}
        </span>
        <time
          className="ms-auto text-muted-foreground"
          dateTime={run.createdAt}
        >
          {at}
        </time>
      </div>
      {started?.error ? (
        <p className="text-destructive text-sm">{started.error}</p>
      ) : null}
      {started?.summary ? (
        <p className="line-clamp-3 text-sm">{started.summary}</p>
      ) : null}
      {href ? (
        <a
          className="self-start text-muted-foreground text-xs underline-offset-2 hover:text-foreground hover:underline"
          href={href}
        >
          <Trans>Open in chat</Trans>
        </a>
      ) : null}
    </li>
  );
}

export function RunHistory({ schedule }: { readonly schedule: Schedule }) {
  const { client } = useApi();
  const runs = useInfiniteQuery({
    getNextPageParam: (last: ScheduleRun[]) =>
      last.length < RUNS_PAGE ? undefined : last.at(-1)?.createdAt,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      client.schedules.runs({
        before: pageParam,
        id: schedule.id,
        limit: RUNS_PAGE,
      }),
    queryKey: ["schedules", "runs", schedule.id],
  });
  const { fetchNextPage } = runs;
  const older = useCallback(() => fetchNextPage(), [fetchNextPage]);
  if (runs.isPending) {
    return <Spinner />;
  }
  if (runs.isError) {
    return (
      <p className="text-destructive text-sm">
        <Trans>Run history is unavailable right now.</Trans>
      </p>
    );
  }
  const items = runs.data.pages.flat();
  if (items.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        <Trans>No runs yet. Each one shows up here, quiet ones included.</Trans>
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-2">
        {items.map((run) => (
          <RunItem
            key={run.id}
            run={run}
            timezone={schedule.recurrence.timezone}
          />
        ))}
      </ul>
      {runs.hasNextPage ? (
        <Button
          className="self-start"
          disabled={runs.isFetchingNextPage}
          onClick={older}
          size="sm"
          variant="ghost"
        >
          <Trans>Show older</Trans>
        </Button>
      ) : null}
    </div>
  );
}

export function ScheduleRow({
  onEdit,
  schedule,
}: {
  readonly onEdit: (schedule: Schedule) => void;
  readonly schedule: Schedule;
}) {
  const { t } = useLingui();
  const { client } = useApi();
  const { add } = useToastManager();
  const refresh = useRefreshSchedules();
  const say = useRecurrenceText();
  const timing = useTimingText();
  const [open, setOpen] = useState(false);
  const { title } = schedule;
  const failureTitle = (code: unknown): string => {
    if (code === "RATE_LIMITED") {
      return t`You've used today's scheduled runs.`;
    }
    if (code === "CONFLICT") {
      return t`It can't do that right now.`;
    }
    return t`Something went wrong. Try again.`;
  };
  const failed = (error: unknown) => {
    const code = codeOf(error);
    add({
      title: failureTitle(code),
      type: "error",
    });
  };
  const toggle = useMutation({
    mutationFn: () =>
      schedule.status === "active"
        ? client.schedules.pause({ id: schedule.id })
        : client.schedules.resume({ id: schedule.id }),
    onError: failed,
    onSettled: refresh,
  });
  const runNow = useMutation({
    mutationFn: () => client.schedules.runNow({ id: schedule.id }),
    onError: failed,
    onSettled: refresh,
    onSuccess: () => add({ priority: "low", title: t`Running ${title} now` }),
  });
  const remove = useMutation({
    mutationFn: () => client.schedules.delete({ id: schedule.id }),
    onError: failed,
    onSettled: refresh,
  });
  const edit = useCallback(() => onEdit(schedule), [onEdit, schedule]);
  const openDrawer = useCallback(() => setOpen(true), []);
  const { mutate: runNowMutate } = runNow;
  const { mutate: toggleMutate } = toggle;
  const { mutate: removeMutate } = remove;
  const runIt = useCallback(() => runNowMutate(), [runNowMutate]);
  const toggleIt = useCallback(() => toggleMutate(), [toggleMutate]);
  const removeIt = useCallback(() => removeMutate(), [removeMutate]);
  const attention =
    schedule.status === "paused" && schedule.pausedReason !== "user";
  return (
    <li
      className={cn(
        "flex flex-col gap-2 rounded-xl border border-border bg-card p-4",
        schedule.status !== "active" && "bg-transparent"
      )}
    >
      <div className="flex items-start gap-3">
        <button
          className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-start outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          onClick={openDrawer}
          type="button"
        >
          <span className="flex w-full items-center gap-2">
            <span aria-hidden className="shrink-0">
              {schedule.emoji}
            </span>
            <span className="truncate font-medium">{title}</span>
            {schedule.lastOutcome === "needs_attention" ? (
              <Badge>
                <Trans>Needs attention</Trans>
              </Badge>
            ) : null}
          </span>
          <span className="truncate text-muted-foreground text-sm">
            {say(schedule.recurrence)} · <TargetText schedule={schedule} />
          </span>
          <span
            className={cn(
              "text-xs",
              attention ? "text-destructive" : "text-muted-foreground"
            )}
          >
            {timing(schedule)}
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            aria-label={t`Run ${title} now`}
            disabled={runNow.isPending || schedule.status === "completed"}
            onClick={runIt}
            size="icon-sm"
            title={t`Run now`}
            variant="ghost"
          >
            {runNow.isPending ? <Spinner /> : <ZapIcon />}
          </Button>
          {schedule.status === "completed" ? null : (
            <Button
              aria-label={
                schedule.status === "active"
                  ? t`Pause ${title}`
                  : t`Resume ${title}`
              }
              disabled={toggle.isPending}
              onClick={toggleIt}
              size="icon-sm"
              title={schedule.status === "active" ? t`Pause` : t`Resume`}
              variant="ghost"
            >
              {schedule.status === "active" ? <PauseIcon /> : <PlayIcon />}
            </Button>
          )}
          <Button
            aria-label={t`Edit ${title}`}
            onClick={edit}
            size="icon-sm"
            title={t`Edit`}
            variant="ghost"
          >
            <PencilIcon />
          </Button>
          <ConfirmButton
            confirmLabel={<Trans>Delete</Trans>}
            description={
              <Trans>
                This permanently deletes {title} and stops future runs. What it
                already posted stays in its chat.
              </Trans>
            }
            disabled={remove.isPending}
            label={t`Delete ${title}`}
            onConfirm={removeIt}
            title={<Trans>Delete {title}?</Trans>}
          >
            <Trash2Icon />
          </ConfirmButton>
        </div>
      </div>
      <Drawer onOpenChange={setOpen} open={open} swipeDirection="right">
        <DrawerContent className="sm:[--drawer-content-width:28rem]">
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
            <DrawerHeader className="gap-1 p-0">
              <DrawerTitle className="flex items-center gap-2 font-semibold text-lg">
                <span aria-hidden>{schedule.emoji}</span>
                {title}
              </DrawerTitle>
              <DrawerDescription>
                {say(schedule.recurrence)} · {schedule.recurrence.timezone}
              </DrawerDescription>
            </DrawerHeader>
            <p className="whitespace-pre-wrap rounded-lg bg-muted p-3 text-sm">
              {schedule.prompt}
            </p>
            <p className="text-muted-foreground text-xs">{timing(schedule)}</p>
            <h3 className="font-medium text-sm">
              <Trans>Run history</Trans>
            </h3>
            {open ? <RunHistory schedule={schedule} /> : null}
          </div>
        </DrawerContent>
      </Drawer>
    </li>
  );
}
