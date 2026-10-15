"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Dot, DotStatus } from "@workspace/contract/schemas/dots";
import {
  BotIcon,
  LoaderCircleIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  SunIcon,
  Trash2Icon,
} from "@workspace/icons";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty";
import { Switch } from "@workspace/ui/components/switch";
import { cn } from "@workspace/ui/lib/utils";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import { useApi } from "@/app/(app)/_shared/api";
import { QueryState } from "@/app/(app)/_shared/query-state";
import { routes } from "@/lib/routes";

import { DotDialog, type DotDraft, dailyBriefDraft } from "./dot-dialog";
import { useNextRunText, useSchedulesSummary } from "./schedule-text";

// The Dots page (172): every always-on agent the user has, what it's doing,
// when it runs next and what it last said. Opening one shows its chat.

/** How often the list refreshes while it's open: runs finish on their own. */
export const DOTS_REFRESH_MS = 10_000;

const StatusPill = ({ status }: { readonly status: DotStatus }) => {
  switch (status) {
    case "running":
      return (
        <Badge variant="secondary">
          <LoaderCircleIcon className="motion-safe:animate-spin" />
          <Trans>Running</Trans>
        </Badge>
      );
    case "failed":
      return (
        <Badge variant="destructive">
          <Trans>Failed</Trans>
        </Badge>
      );
    case "idle":
      return (
        <Badge variant="outline">
          <Trans>Idle</Trans>
        </Badge>
      );
    default:
      return status satisfies never;
  }
};

const DotRow = ({
  dot,
  onEdit,
}: {
  readonly dot: Dot;
  readonly onEdit: (dot: Dot) => void;
}) => {
  const { t } = useLingui();
  const router = useRouter();
  const { client, query } = useApi();
  const queryClient = useQueryClient();
  const summary = useSchedulesSummary();
  const nextText = useNextRunText();
  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: query.dots.key() }),
    [query, queryClient]
  );
  const runNow = useMutation({
    mutationFn: () => client.dots.runNow({ id: dot.id }),
    onSettled: refresh,
  });
  const toggle = useMutation({
    mutationFn: (enabled: boolean) =>
      client.dots.update({ enabled, id: dot.id }),
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: () => client.dots.delete({ id: dot.id }),
    onSettled: refresh,
  });
  const open = useCallback(() => {
    client.dots
      .markRead({ id: dot.id })
      .then(refresh)
      .catch(() => undefined);
    router.push(routes.chat(dot.conversationId));
  }, [client, dot.conversationId, dot.id, refresh, router]);
  const edit = useCallback(() => onEdit(dot), [dot, onEdit]);
  const { mutate: run } = runNow;
  const start = useCallback(() => run(), [run]);
  const { mutate: toggleMutate } = toggle;
  const setEnabled = useCallback(
    (enabled: boolean) => toggleMutate(enabled),
    [toggleMutate]
  );
  const { mutate: del } = remove;
  const confirmDelete = useCallback(() => del(), [del]);
  const { name } = dot;
  const next = dot.enabled ? nextText(dot.nextRunAt) : null;
  const snippet = dot.lastRun?.error ?? dot.lastRun?.snippet ?? null;

  return (
    <li className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-start">
      <button
        aria-label={t`Open ${name}`}
        className="flex min-w-0 flex-1 items-start gap-3 rounded-md text-start outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        onClick={open}
        type="button"
      >
        <span className="relative mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
          <BotIcon aria-hidden className="size-4" />
          {dot.unread ? (
            <span
              className="absolute -end-0.5 -top-0.5 size-2.5 rounded-full bg-primary ring-2 ring-card"
              title={t`New result`}
            />
          ) : null}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "truncate text-sm",
                dot.unread ? "font-semibold" : "font-medium"
              )}
            >
              {dot.name}
            </span>
            <StatusPill status={dot.status} />
            {dot.unread ? (
              <span className="sr-only">
                <Trans>Unread</Trans>
              </span>
            ) : null}
          </span>
          <span className="text-muted-foreground text-xs">
            {summary(dot)}
            {next ? (
              <>
                {" · "}
                <Trans>next {next}</Trans>
              </>
            ) : null}
          </span>
          {snippet ? (
            <span
              className={cn(
                "line-clamp-2 text-sm",
                dot.lastRun?.error
                  ? "text-destructive"
                  : "text-muted-foreground"
              )}
            >
              {snippet}
            </span>
          ) : (
            <span className="text-muted-foreground text-sm">
              <Trans>No runs yet.</Trans>
            </span>
          )}
        </span>
      </button>
      <div className="flex shrink-0 items-center gap-1 sm:pt-1">
        <Switch
          aria-label={t`${name} on`}
          checked={dot.enabled}
          onCheckedChange={setEnabled}
        />
        <Button
          disabled={runNow.isPending || dot.status === "running"}
          onClick={start}
          size="sm"
          variant="outline"
        >
          <PlayIcon data-icon="inline-start" />
          <Trans>Run now</Trans>
        </Button>
        <Button
          aria-label={t`Edit ${name}`}
          onClick={edit}
          size="icon-sm"
          variant="ghost"
        >
          <PencilIcon />
        </Button>
        <Button
          aria-label={t`Delete ${name}`}
          disabled={remove.isPending}
          onClick={confirmDelete}
          size="icon-sm"
          variant="ghost"
        >
          <Trash2Icon />
        </Button>
      </div>
    </li>
  );
};

export function DotsScreen() {
  const { t } = useLingui();
  const { query } = useApi();
  const queryClient = useQueryClient();
  const dots = useQuery({
    ...query.dots.list.queryOptions({ input: {} }),
    refetchInterval: DOTS_REFRESH_MS,
  });
  const models = useQuery(
    query.meta.models.queryOptions({ input: { contextType: "personal" } })
  );
  const [editing, setEditing] = useState<{
    readonly dot?: Dot;
    readonly initial?: DotDraft;
  } | null>(null);
  const close = useCallback((open: boolean) => {
    if (!open) {
      setEditing(null);
    }
  }, []);
  const saved = useCallback(
    () => queryClient.invalidateQueries({ queryKey: query.dots.key() }),
    [query, queryClient]
  );
  const create = useCallback(() => setEditing({}), []);
  const edit = useCallback((dot: Dot) => setEditing({ dot }), []);
  const firstModel = models.data?.find((model) => model.available);
  const template = useCallback(
    () =>
      setEditing({
        initial: dailyBriefDraft(
          firstModel ? `model:${firstModel.selector}` : "",
          t`Give me my daily brief: list what's in /work, note anything new since yesterday, and suggest one thing to do today.`,
          t`Keep it short: three bullet points at most.`,
          t`Daily brief`
        ),
      }),
    [firstModel, t]
  );

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="font-semibold text-2xl">
            <Trans>Dots</Trans>
          </h1>
          <p className="text-muted-foreground text-sm">
            <Trans>
              Always-on agents that run on a schedule, in their own workspace,
              and report back in their own chat.
            </Trans>
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={template} variant="outline">
            <SunIcon data-icon="inline-start" />
            <Trans>Daily brief</Trans>
          </Button>
          <Button onClick={create}>
            <PlusIcon data-icon="inline-start" />
            <Trans>New Dot</Trans>
          </Button>
        </div>
      </header>
      <QueryState query={dots}>
        {(list) =>
          list.length === 0 ? (
            <Empty className="border border-border border-dashed">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <BotIcon />
                </EmptyMedia>
                <EmptyTitle>
                  <Trans>No Dots yet</Trans>
                </EmptyTitle>
                <EmptyDescription>
                  <Trans>
                    Start with a daily brief, or make your own: pick a model or
                    agent, say what it should do, and when.
                  </Trans>
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button onClick={template}>
                  <SunIcon data-icon="inline-start" />
                  <Trans>Create a daily brief</Trans>
                </Button>
              </EmptyContent>
            </Empty>
          ) : (
            <ul className="flex flex-col gap-3">
              {list.map((dot) => (
                <DotRow dot={dot} key={dot.id} onEdit={edit} />
              ))}
            </ul>
          )
        }
      </QueryState>
      <DotDialog
        dot={editing?.dot}
        initial={editing?.initial}
        onOpenChange={close}
        onSaved={saved}
        open={editing !== null}
      />
    </div>
  );
}
