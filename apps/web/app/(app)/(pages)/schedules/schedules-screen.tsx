"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import type {
  Schedule,
  ScheduleStatus,
} from "@workspace/contract/schemas/schedules";
import { ClockIcon, PlusIcon, SearchIcon } from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty";
import { Input } from "@workspace/ui/components/input";
import { Tabs, TabsList, TabsTrigger } from "@workspace/ui/components/tabs";
import { useSearchParams } from "next/navigation";
import {
  type ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useApi } from "@/app/(app)/_shared/api";
import { QueryState } from "@/app/(app)/_shared/query-state";
import { routeParams } from "@/lib/routes";

import { ScheduleEditor, type ScheduleSeed } from "./schedule-editor";
import { ScheduleRow } from "./schedule-list";

// The schedules page (183): every scheduled task you own, whatever it
// posts into, with search, status filters, today's usage against the
// guardrails, and starter templates when there are none.

type Filter = "all" | ScheduleStatus;

/** Refetch while open, so "Next …" and a running Run now stay current. */
const SCHEDULES_REFRESH_MS = 30_000;

export function SchedulesScreen() {
  const { t } = useLingui();
  const { query } = useApi();
  const schedules = useQuery({
    ...query.schedules.list.queryOptions({ input: {} }),
    refetchInterval: SCHEDULES_REFRESH_MS,
  });
  const limits = useQuery(query.schedules.limits.queryOptions({ input: {} }));
  const dots = useQuery(query.dots.list.queryOptions({ input: {} }));
  const hasDot = (dots.data?.length ?? 0) > 0;
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<{
    readonly schedule: Schedule | null;
    readonly seed: ScheduleSeed | null;
  } | null>(null);

  const templates: readonly ScheduleSeed[] = useMemo(
    () => [
      {
        prompt: t`Give me a short brief for today: what's on, what changed overnight, and anything I should look at first.`,
        title: t`Daily brief`,
        when: "every morning at 8",
      },
      {
        prompt: t`Check whether anything I'm waiting on has moved. Only tell me if something needs a reply or a decision.`,
        title: t`Follow-up monitor`,
        when: "weekdays at 2pm",
      },
      {
        prompt: t`Review my week: what got done, what slipped, and three things to focus on next week.`,
        title: t`Weekly review`,
        when: "every friday at 4pm",
      },
    ],
    [t]
  );

  const create = useCallback(
    (seed: ScheduleSeed | null = null) => setEditing({ schedule: null, seed }),
    []
  );
  const createBlank = useCallback(() => create(), [create]);
  const edit = useCallback(
    (schedule: Schedule) => setEditing({ schedule, seed: null }),
    []
  );
  // The rail panel links here with `?edit=<id>` or `?edit=new` (181): open
  // that one in the editor, once per link followed.
  const asked = useSearchParams().get(routeParams.edit);
  const handled = useRef<string | null>(null);
  const loaded = schedules.data;
  useEffect(() => {
    if (!asked || handled.current === asked) {
      return;
    }
    if (asked === "new") {
      handled.current = asked;
      setEditing({ schedule: null, seed: null });
      return;
    }
    const found = loaded?.find((schedule) => schedule.id === asked);
    if (found) {
      handled.current = asked;
      setEditing({ schedule: found, seed: null });
    }
  }, [asked, loaded]);
  const close = useCallback((open: boolean) => {
    if (!open) {
      setEditing(null);
    }
  }, []);
  const changeSearch = useCallback(
    (event: ChangeEvent<HTMLInputElement>) =>
      setSearch(event.currentTarget.value),
    []
  );
  const changeFilter = useCallback(
    (value: unknown) => setFilter(value as Filter),
    []
  );

  const used = limits.data?.runsToday ?? 0;
  const cap = limits.data?.maxRunsPerDay ?? 0;
  const min = limits.data?.minIntervalMinutes ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="font-semibold text-2xl">
            <Trans>Scheduled</Trans>
          </h1>
          <p className="text-muted-foreground text-sm">
            <Trans>
              Tasks that run on their own and post into your Dot or a chat.
            </Trans>
          </p>
          {limits.data ? (
            <p className="text-muted-foreground text-xs tabular-nums">
              <Trans>
                {used} of {cap} runs used in the last 24 hours · every {min}{" "}
                minutes or longer
              </Trans>
            </p>
          ) : null}
        </div>
        <Button onClick={createBlank}>
          <PlusIcon data-icon="inline-start" />
          <Trans>New task</Trans>
        </Button>
      </header>

      <QueryState query={schedules}>
        {(list) => {
          if (list.length === 0) {
            return (
              <Empty className="border border-border border-dashed">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <ClockIcon />
                  </EmptyMedia>
                  <EmptyTitle>
                    <Trans>No scheduled tasks yet</Trans>
                  </EmptyTitle>
                  <EmptyDescription>
                    <Trans>
                      Start from one of these, or ask your Dot: “every weekday
                      at 8, brief me”.
                    </Trans>
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-3">
                    {templates.map((template) => (
                      <TemplateButton
                        key={template.title}
                        onPick={create}
                        template={template}
                      />
                    ))}
                  </div>
                </EmptyContent>
              </Empty>
            );
          }
          const needle = search.trim().toLowerCase();
          const shown = list.filter(
            (schedule) =>
              (filter === "all" || schedule.status === filter) &&
              (needle === "" ||
                schedule.title.toLowerCase().includes(needle) ||
                schedule.prompt.toLowerCase().includes(needle))
          );
          return (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <Tabs onValueChange={changeFilter} value={filter}>
                  <TabsList>
                    <TabsTrigger value="all">
                      <Trans>All</Trans>
                    </TabsTrigger>
                    <TabsTrigger value="active">
                      <Trans>Active</Trans>
                    </TabsTrigger>
                    <TabsTrigger value="paused">
                      <Trans>Paused</Trans>
                    </TabsTrigger>
                    <TabsTrigger value="completed">
                      <Trans>Completed</Trans>
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
                <div className="relative ms-auto w-full sm:w-64">
                  <SearchIcon
                    aria-hidden
                    className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  />
                  <Input
                    aria-label={t`Search scheduled tasks`}
                    className="ps-8"
                    onChange={changeSearch}
                    placeholder={t`Search`}
                    type="search"
                    value={search}
                  />
                </div>
              </div>
              {shown.length === 0 ? (
                <p className="py-8 text-center text-muted-foreground text-sm">
                  <Trans>Nothing matches.</Trans>
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {shown.map((schedule) => (
                    <ScheduleRow
                      key={schedule.id}
                      onEdit={edit}
                      schedule={schedule}
                    />
                  ))}
                </ul>
              )}
            </div>
          );
        }}
      </QueryState>

      {editing ? (
        <ScheduleEditor
          hasDot={hasDot}
          key={editing.schedule?.id ?? editing.seed?.title ?? "new"}
          onOpenChange={close}
          open
          schedule={editing.schedule}
          seed={editing.seed}
        />
      ) : null}
    </div>
  );
}

function TemplateButton({
  onPick,
  template,
}: {
  readonly onPick: (seed: ScheduleSeed) => void;
  readonly template: ScheduleSeed;
}) {
  const pick = useCallback(() => onPick(template), [onPick, template]);
  return (
    <button
      className="flex flex-col gap-1 rounded-lg border border-border p-3 text-start outline-none transition-colors duration-(--motion-fast) hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.98]"
      onClick={pick}
      type="button"
    >
      <span className="font-medium text-sm">{template.title}</span>
      <span className="line-clamp-2 text-muted-foreground text-xs">
        {template.prompt}
      </span>
    </button>
  );
}
