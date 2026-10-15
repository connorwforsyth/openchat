"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Dot,
  DotActivity,
  DotSchedule,
} from "@workspace/contract/schemas/dots";
import type { RunStatus } from "@workspace/contract/schemas/runs";
import {
  ClockIcon,
  HistoryIcon,
  MonitorIcon,
  PencilIcon,
  PlusIcon,
  ShieldIcon,
  SparklesIcon,
  StarIcon,
  Trash2Icon,
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
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import { Spinner } from "@workspace/ui/components/spinner";
import { Switch } from "@workspace/ui/components/switch";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs";
import { Textarea } from "@workspace/ui/components/textarea";
import { useRouter } from "next/navigation";
import {
  type ChangeEvent,
  type FormEvent,
  useCallback,
  useId,
  useState,
} from "react";

import { useApi } from "@/app/(app)/_shared/api";
import { useAppFrame } from "@/app/(app)/_shared/app-frame";
import { routes } from "@/lib/routes";

import { DotAvatar } from "./dot-avatar";
import { DotSettingsDialog } from "./dot-dialog";
import { type DotExtensions, dotExtensions } from "./dot-extensions";
import { PRESET_CRON } from "./schedule";
import { newSchedule, type ScheduleDraft, ScheduleRow } from "./schedule-row";
import { useNextRunText, useScheduleText } from "./schedule-text";

// A Dot's profile (172): who it is at the top, then what it's done
// (Activity), what it will do (Scheduled), what it may do alone (Rules), its
// computer (a slot the computer work fills) and what it remembers. A side
// sheet over its chat, so the conversation stays where it was.

export type DotProfileTab =
  | "activity"
  | "scheduled"
  | "rules"
  | "computer"
  | "memory";

const useRefreshDots = () => {
  const { query } = useApi();
  const queryClient = useQueryClient();
  return useCallback(
    () => queryClient.invalidateQueries({ queryKey: query.dots.key() }),
    [query, queryClient]
  );
};

export function RunStatusBadge({ status }: { readonly status: RunStatus }) {
  switch (status) {
    case "queued":
    case "running":
    case "awaiting_approval":
      return (
        <Badge variant="secondary">
          <Spinner />
          <Trans>Running</Trans>
        </Badge>
      );
    case "succeeded":
      return (
        <Badge variant="outline">
          <Trans>Done</Trans>
        </Badge>
      );
    case "failed":
      return (
        <Badge variant="destructive">
          <Trans>Failed</Trans>
        </Badge>
      );
    case "cancelled":
      return (
        <Badge variant="outline">
          <Trans>Stopped</Trans>
        </Badge>
      );
    default:
      return status satisfies never;
  }
}

const useWhen = () => {
  const { i18n } = useLingui();
  return useCallback(
    (iso: string) =>
      new Intl.DateTimeFormat(i18n.locale, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(iso)),
    [i18n.locale]
  );
};

function ActivityItem({
  item,
  schedules,
}: {
  readonly item: DotActivity;
  readonly schedules: readonly DotSchedule[];
}) {
  const when = useWhen();
  const say = useScheduleText();
  const schedule = schedules.find((each) => each.id === item.scheduleId);
  const started = when(item.startedAt);
  return (
    <li className="flex flex-col gap-1 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <RunStatusBadge status={item.status} />
        <span className="text-muted-foreground">
          {item.trigger === "manual" ? <Trans>Run now</Trans> : null}
          {item.trigger === "schedule" && schedule ? (
            <Trans>Scheduled · {say(schedule.cron)}</Trans>
          ) : null}
          {item.trigger === "schedule" && !schedule ? (
            <Trans>Scheduled</Trans>
          ) : null}
        </span>
        <time
          className="ms-auto text-muted-foreground"
          dateTime={item.startedAt}
        >
          {started}
        </time>
      </div>
      {item.error ? (
        <p className="text-destructive text-sm">{item.error}</p>
      ) : null}
      {item.snippet ? (
        <p className="line-clamp-3 text-sm">{item.snippet}</p>
      ) : null}
    </li>
  );
}

function ActivityTab({ dot }: { readonly dot: Dot }) {
  const { query } = useApi();
  const activity = useQuery(
    query.dots.activity.queryOptions({ input: { id: dot.id, limit: 30 } })
  );
  if (activity.isPending) {
    return <Spinner />;
  }
  const items = activity.data ?? [];
  if (items.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        <Trans>
          Nothing yet. When {dot.name} works on its own, each run shows up here.
        </Trans>
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {items.map((item) => (
        <ActivityItem item={item} key={item.runId} schedules={dot.schedules} />
      ))}
    </ul>
  );
}

const draftOfSchedule = (schedule: DotSchedule): ScheduleDraft => ({
  cron: schedule.cron,
  enabled: schedule.enabled,
  id: schedule.id,
  key: schedule.id,
  prompt: schedule.prompt,
  timezone: schedule.timezone,
});

function ScheduleEditor({
  dot,
  initial,
  onDone,
}: {
  readonly dot: Dot;
  readonly initial: ScheduleDraft;
  readonly onDone: () => void;
}) {
  const { client } = useApi();
  const refresh = useRefreshDots();
  const [draft, setDraft] = useState(initial);
  const save = useMutation({
    mutationFn: () => {
      const fields = {
        cron: draft.cron.trim(),
        enabled: draft.enabled,
        prompt: draft.prompt.trim(),
        timezone: draft.timezone.trim() || "UTC",
      };
      return draft.id
        ? client.dots.updateSchedule({ id: draft.id, ...fields })
        : client.dots.createSchedule({ dotId: dot.id, ...fields });
    },
    onSuccess: async () => {
      await refresh();
      onDone();
    },
  });
  const change = useCallback(
    (_index: number, next: ScheduleDraft) => setDraft(next),
    []
  );
  const { mutate } = save;
  const submit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      mutate();
    },
    [mutate]
  );
  return (
    <form className="flex flex-col gap-2" onSubmit={submit}>
      <ScheduleRow
        index={0}
        onChange={change}
        onRemove={onDone}
        schedule={draft}
      />
      {save.isError ? (
        <FieldError>
          <Trans>Check the cron and time zone, then try again.</Trans>
        </FieldError>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button onClick={onDone} size="sm" type="button" variant="ghost">
          <Trans>Cancel</Trans>
        </Button>
        <Button disabled={save.isPending} size="sm" type="submit">
          {save.isPending ? <Spinner data-icon="inline-start" /> : null}
          <Trans>Save</Trans>
        </Button>
      </div>
    </form>
  );
}

function ScheduleItem({
  dot,
  onEdit,
  schedule,
}: {
  readonly dot: Dot;
  readonly onEdit: (schedule: DotSchedule) => void;
  readonly schedule: DotSchedule;
}) {
  const { t } = useLingui();
  const { client } = useApi();
  const refresh = useRefreshDots();
  const say = useScheduleText();
  const nextText = useNextRunText();
  const toggle = useMutation({
    mutationFn: (enabled: boolean) =>
      client.dots.updateSchedule({ enabled, id: schedule.id }),
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: () => client.dots.deleteSchedule({ id: schedule.id }),
    onSettled: refresh,
  });
  const { mutate: toggleMutate } = toggle;
  const setEnabled = useCallback(
    (enabled: boolean) => toggleMutate(enabled),
    [toggleMutate]
  );
  const edit = useCallback(() => onEdit(schedule), [onEdit, schedule]);
  const { mutate: removeMutate } = remove;
  const del = useCallback(() => removeMutate(), [removeMutate]);
  const when = say(schedule.cron);
  const next =
    dot.enabled && schedule.enabled ? nextText(schedule.nextRunAt) : null;
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-medium text-sm">
          {when}
        </span>
        <Switch
          aria-label={t`${when} on`}
          checked={schedule.enabled}
          onCheckedChange={setEnabled}
        />
        <Button
          aria-label={t`Edit ${when}`}
          onClick={edit}
          size="icon-sm"
          variant="ghost"
        >
          <PencilIcon />
        </Button>
        <Button
          aria-label={t`Delete ${when}`}
          disabled={remove.isPending}
          onClick={del}
          size="icon-sm"
          variant="ghost"
        >
          <Trash2Icon />
        </Button>
      </div>
      <p className="line-clamp-2 text-muted-foreground text-sm">
        {schedule.prompt}
      </p>
      <p className="text-muted-foreground text-xs">
        {schedule.timezone}
        {next ? (
          <>
            {" · "}
            <Trans>next {next}</Trans>
          </>
        ) : null}
        {schedule.enabled ? null : (
          <>
            {" · "}
            <Trans>Paused</Trans>
          </>
        )}
      </p>
    </li>
  );
}

function ScheduledTab({ dot }: { readonly dot: Dot }) {
  const [editing, setEditing] = useState<ScheduleDraft | null>(null);
  const add = useCallback(
    () => setEditing(newSchedule(PRESET_CRON.morning, "")),
    []
  );
  const edit = useCallback(
    (schedule: DotSchedule) => setEditing(draftOfSchedule(schedule)),
    []
  );
  const done = useCallback(() => setEditing(null), []);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-sm">
        <Trans>
          Or just ask {dot.name} in the chat: “every weekday at 8, brief me”.
        </Trans>
      </p>
      {dot.schedules.length === 0 && !editing ? (
        <p className="text-sm">
          <Trans>No scheduled tasks yet.</Trans>
        </p>
      ) : null}
      <ul className="flex flex-col gap-2">
        {dot.schedules.map((schedule) =>
          editing?.id === schedule.id ? (
            <li key={schedule.id}>
              <ScheduleEditor dot={dot} initial={editing} onDone={done} />
            </li>
          ) : (
            <ScheduleItem
              dot={dot}
              key={schedule.id}
              onEdit={edit}
              schedule={schedule}
            />
          )
        )}
      </ul>
      {editing && editing.id === null ? (
        <ScheduleEditor dot={dot} initial={editing} onDone={done} />
      ) : (
        <Button
          className="self-start"
          onClick={add}
          size="sm"
          variant="outline"
        >
          <PlusIcon data-icon="inline-start" />
          <Trans>Add a scheduled task</Trans>
        </Button>
      )}
    </div>
  );
}

const TOOL_SEPARATOR = /[\s,]+/;

function RulesTab({ dot }: { readonly dot: Dot }) {
  const { t } = useLingui();
  const ids = useId();
  const { client } = useApi();
  const refresh = useRefreshDots();
  const [tools, setTools] = useState(dot.autoApproveTools.join(", "));
  const [rules, setRules] = useState(dot.rules);
  const save = useMutation({
    mutationFn: () =>
      client.dots.update({
        autoApproveTools: tools
          .split(TOOL_SEPARATOR)
          .map((tool) => tool.trim())
          .filter((tool) => tool !== ""),
        id: dot.id,
        rules,
      }),
    onSettled: refresh,
  });
  const changeRules = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) =>
      setRules(event.currentTarget.value),
    []
  );
  const changeTools = useCallback(
    (event: ChangeEvent<HTMLInputElement>) =>
      setTools(event.currentTarget.value),
    []
  );
  const { mutate } = save;
  const submit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      mutate();
    },
    [mutate]
  );
  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      <p className="text-muted-foreground text-sm">
        <Trans>
          {dot.name} knows when to act and when to ask. When you're chatting,
          anything that needs approval asks you first. When it works on its own,
          nobody is there to ask, so those tools are skipped, unless you allow
          them here.
        </Trans>
      </p>
      <Field>
        <FieldLabel htmlFor={`${ids}-rules`}>
          <Trans>When to ask first</Trans>
        </FieldLabel>
        <Textarea
          id={`${ids}-rules`}
          maxLength={4000}
          onChange={changeRules}
          placeholder={t`Ask before you email anyone outside my team. Never delete files.`}
          rows={4}
          value={rules}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={`${ids}-tools`}>
          <Trans>Tools it may use on its own</Trans>
        </FieldLabel>
        <Input
          autoComplete="off"
          className="font-mono"
          id={`${ids}-tools`}
          onChange={changeTools}
          placeholder="write, edit, schedule_task"
          value={tools}
        />
        <FieldDescription>
          <Trans>
            Tool names, separated by commas. Add schedule_task to let it add its
            own scheduled tasks while you're away.
          </Trans>
        </FieldDescription>
      </Field>
      <Button
        className="self-end"
        disabled={save.isPending}
        size="sm"
        type="submit"
      >
        {save.isPending ? <Spinner data-icon="inline-start" /> : null}
        {save.isSuccess ? <Trans>Saved</Trans> : <Trans>Save rules</Trans>}
      </Button>
    </form>
  );
}

function MemoryTab({ dot }: { readonly dot: Dot }) {
  const { query } = useApi();
  const memory = useQuery(query.memory.get.queryOptions());
  const content = memory.data?.content.trim() ?? "";
  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-sm">
        <Trans>
          {dot.name} works as you, so it shares your memory: what it learns in
          your chats, it keeps here.
        </Trans>
      </p>
      {memory.isPending ? <Spinner /> : null}
      {memory.data && content === "" ? (
        <p className="text-sm">
          <Trans>Nothing remembered yet.</Trans>
        </p>
      ) : null}
      {memory.data && content !== "" ? (
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-muted p-3 text-sm">
          {content}
        </pre>
      ) : null}
      <a
        className="self-start text-sm underline underline-offset-4"
        href={routes.settings("memory")}
      >
        <Trans>Manage memory</Trans>
      </a>
    </div>
  );
}

export interface DotProfileProps {
  readonly dot: Dot;
  /** Plug-ins for the Computer tab; defaults to `dotExtensions`. */
  readonly extensions?: Partial<DotExtensions>;
  readonly onOpenChange: (open: boolean) => void;
  readonly onTabChange: (tab: DotProfileTab) => void;
  readonly open: boolean;
  readonly tab: DotProfileTab;
}

export function DotProfile({
  dot,
  extensions,
  onOpenChange,
  onTabChange,
  open,
  tab,
}: DotProfileProps) {
  const { t } = useLingui();
  const router = useRouter();
  const { client } = useApi();
  const { config } = useAppFrame();
  const refresh = useRefreshDots();
  const [editing, setEditing] = useState(false);
  const { ComputerTab, ComputerTabLabel } = { ...dotExtensions, ...extensions };
  const makePrimary = useMutation({
    mutationFn: () => client.dots.update({ id: dot.id, primary: true }),
    onSettled: refresh,
  });
  const toggle = useMutation({
    mutationFn: (enabled: boolean) =>
      client.dots.update({ enabled, id: dot.id }),
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: () => client.dots.delete({ id: dot.id }),
    onSuccess: async () => {
      await refresh();
      router.push(routes.dots);
    },
  });
  const memoryOn = config.features.memory;
  const edit = useCallback(() => setEditing(true), []);
  const { mutate: primaryMutate } = makePrimary;
  const promote = useCallback(() => primaryMutate(), [primaryMutate]);
  const { mutate: toggleMutate } = toggle;
  const setEnabled = useCallback(
    (enabled: boolean) => toggleMutate(enabled),
    [toggleMutate]
  );
  const { mutate: removeMutate } = remove;
  const del = useCallback(() => removeMutate(), [removeMutate]);
  const changeTab = useCallback(
    (value: unknown) => onTabChange(value as DotProfileTab),
    [onTabChange]
  );
  const { name } = dot;

  return (
    <Drawer onOpenChange={onOpenChange} open={open} swipeDirection="right">
      <DrawerContent className="sm:[--drawer-content-width:28rem]">
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <DrawerHeader className="items-center gap-3 pb-2 text-center">
            <DotAvatar avatar={dot.avatar} size="lg" />
            <div className="flex flex-col items-center gap-0.5">
              <DrawerTitle className="font-semibold text-lg">
                {dot.name}
              </DrawerTitle>
              <DrawerDescription>
                @{dot.handle}
                {dot.primary ? (
                  <>
                    {" · "}
                    <Trans>Your primary Dot</Trans>
                  </>
                ) : null}
              </DrawerDescription>
            </div>
            {dot.instructions.trim() === "" ? null : (
              <p className="line-clamp-3 text-muted-foreground text-sm">
                {dot.instructions}
              </p>
            )}
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button onClick={edit} size="sm" variant="outline">
                <PencilIcon data-icon="inline-start" />
                <Trans>Edit</Trans>
              </Button>
              {dot.primary ? null : (
                <Button
                  disabled={makePrimary.isPending}
                  onClick={promote}
                  size="sm"
                  variant="outline"
                >
                  <StarIcon data-icon="inline-start" />
                  <Trans>Make primary</Trans>
                </Button>
              )}
              <span className="flex items-center gap-2 text-sm">
                <Switch
                  aria-label={t`${name} active`}
                  checked={dot.enabled}
                  onCheckedChange={setEnabled}
                />
                {dot.enabled ? <Trans>Active</Trans> : <Trans>Paused</Trans>}
              </span>
            </div>
          </DrawerHeader>

          <Tabs
            className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-4"
            onValueChange={changeTab}
            value={tab}
          >
            <TabsList className="w-full" variant="line">
              <TabsTrigger value="activity">
                <HistoryIcon aria-hidden />
                <Trans>Activity</Trans>
              </TabsTrigger>
              <TabsTrigger value="scheduled">
                <ClockIcon aria-hidden />
                <Trans>Scheduled</Trans>
              </TabsTrigger>
              <TabsTrigger value="rules">
                <ShieldIcon aria-hidden />
                <Trans>Rules</Trans>
              </TabsTrigger>
              {ComputerTab ? (
                <TabsTrigger value="computer">
                  <MonitorIcon aria-hidden />
                  {ComputerTabLabel ? (
                    <ComputerTabLabel dot={dot} />
                  ) : (
                    <Trans>Computer</Trans>
                  )}
                </TabsTrigger>
              ) : null}
              {memoryOn ? (
                <TabsTrigger value="memory">
                  <SparklesIcon aria-hidden />
                  <Trans>Memory</Trans>
                </TabsTrigger>
              ) : null}
            </TabsList>
            <TabsContent value="activity">
              <ActivityTab dot={dot} />
            </TabsContent>
            <TabsContent value="scheduled">
              <ScheduledTab dot={dot} />
            </TabsContent>
            <TabsContent value="rules">
              <RulesTab dot={dot} key={dot.updatedAt} />
            </TabsContent>
            {ComputerTab ? (
              <TabsContent value="computer">
                <ComputerTab dot={dot} />
              </TabsContent>
            ) : null}
            {memoryOn ? (
              <TabsContent value="memory">
                <MemoryTab dot={dot} />
              </TabsContent>
            ) : null}
          </Tabs>

          <div className="mt-auto border-border border-t p-4">
            <Button
              className="w-full"
              disabled={remove.isPending}
              onClick={del}
              variant="ghost"
            >
              <Trash2Icon data-icon="inline-start" />
              <Trans>Delete {name}</Trans>
            </Button>
          </div>
        </div>
      </DrawerContent>
      <DotSettingsDialog
        dot={dot}
        onOpenChange={setEditing}
        onSaved={refresh}
        open={editing}
      />
    </Drawer>
  );
}
