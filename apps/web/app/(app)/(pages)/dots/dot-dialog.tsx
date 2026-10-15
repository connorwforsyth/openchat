"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQueries, useQuery } from "@tanstack/react-query";
import type { DotScheduleId } from "@workspace/contract/schemas/common";
import type { Dot } from "@workspace/contract/schemas/dots";
import type { RunTarget } from "@workspace/contract/schemas/runs";
import type { SandboxProvider } from "@workspace/contract/schemas/sandbox";
import { PlusIcon, Trash2Icon } from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import { Spinner } from "@workspace/ui/components/spinner";
import { Switch } from "@workspace/ui/components/switch";
import { Textarea } from "@workspace/ui/components/textarea";
import {
  type ChangeEvent,
  type FormEvent,
  useCallback,
  useId,
  useMemo,
  useState,
} from "react";
import { useApi } from "@/app/(app)/_shared/api";
import { type Option, OptionSelect } from "@/app/(app)/_shared/option-select";
import { AGENT_TABS, usableAgents } from "@/app/(app)/(chat)/usable-agents";

import {
  localTimeZone,
  PRESET_CRON,
  presetOf,
  type SchedulePreset,
} from "./schedule";
import { useScheduleText } from "./schedule-text";

// Creating and editing a Dot (172): who answers (a model or a published
// agent), standing instructions, the workspace provider, tools it may run
// unattended, and its schedules with friendly presets and a custom cron.

interface ScheduleDraft {
  readonly cron: string;
  readonly enabled: boolean;
  /** The stored schedule this edits; `null` for a new one. */
  readonly id: DotScheduleId | null;
  /** A stable React key, also for new rows. */
  readonly key: string;
  readonly prompt: string;
  readonly timezone: string;
}

export interface DotDraft {
  readonly autoApproveTools: string;
  readonly instructions: string;
  readonly name: string;
  readonly sandbox: "default" | SandboxProvider;
  readonly schedules: readonly ScheduleDraft[];
  /** `model:<selector>` or `agent:<id>`. */
  readonly target: string;
}

const targetKey = (target: RunTarget): string =>
  target.type === "agent" ? `agent:${target.id}` : `model:${target.model}`;

const targetOf = (key: string): RunTarget | null => {
  const index = key.indexOf(":");
  const kind = key.slice(0, index);
  const value = key.slice(index + 1);
  if (value === "") {
    return null;
  }
  return kind === "agent"
    ? ({ id: value, type: "agent" } as RunTarget)
    : ({ model: value, type: "model" } as RunTarget);
};

let rowSeq = 0;
const rowKey = () => {
  rowSeq += 1;
  return `row-${rowSeq}`;
};

const newSchedule = (cron: string, prompt: string): ScheduleDraft => ({
  cron,
  enabled: true,
  id: null,
  key: rowKey(),
  prompt,
  timezone: localTimeZone(),
});

/** The "Daily brief" template: a Dot ready to save in two clicks. */
export const dailyBriefDraft = (
  target: string,
  prompt: string,
  instructions: string,
  name: string
): DotDraft => ({
  autoApproveTools: "",
  instructions,
  name,
  sandbox: "default",
  schedules: [newSchedule(PRESET_CRON.morning, prompt)],
  target,
});

const draftOf = (dot: Dot): DotDraft => ({
  autoApproveTools: dot.autoApproveTools.join(", "),
  instructions: dot.instructions,
  name: dot.name,
  sandbox: dot.sandboxProvider ?? "default",
  schedules: dot.schedules.map((schedule) => ({
    cron: schedule.cron,
    enabled: schedule.enabled,
    id: schedule.id,
    key: schedule.id,
    prompt: schedule.prompt,
    timezone: schedule.timezone,
  })),
  target: targetKey(dot.target),
});

const TOOL_SEPARATOR = /[\s,]+/;

const toolsOf = (text: string): string[] =>
  text
    .split(TOOL_SEPARATOR)
    .map((tool) => tool.trim())
    .filter((tool) => tool !== "");

const AGENT_LIST_LIMIT = 100;

const useTargetOptions = (): readonly Option<string>[] => {
  const { t } = useLingui();
  const { query } = useApi();
  const models = useQuery(
    query.meta.models.queryOptions({ input: { contextType: "personal" } })
  );
  const agents = useQueries({
    combine: (lists) =>
      usableAgents(
        AGENT_TABS.map((source, index) => ({
          items: lists[index]?.data?.items ?? [],
          source,
        }))
      ).agents,
    queries: AGENT_TABS.map((tab) =>
      query.library.list.queryOptions({
        input: { kind: "agent", limit: AGENT_LIST_LIMIT, tab },
      })
    ),
  });
  return useMemo(
    () => [
      ...(models.data ?? []).map((model) => ({
        disabled: !model.available,
        label: t`Model: ${model.label}`,
        value: `model:${model.selector}`,
      })),
      ...agents.map((agent) => {
        const { name } = agent;
        return { label: t`Agent: ${name}`, value: `agent:${agent.id}` };
      }),
    ],
    [agents, models.data, t]
  );
};

const ScheduleRow = ({
  index,
  onChange,
  onRemove,
  schedule,
}: {
  readonly index: number;
  readonly onChange: (index: number, next: ScheduleDraft) => void;
  readonly onRemove: (index: number) => void;
  readonly schedule: ScheduleDraft;
}) => {
  const { t } = useLingui();
  const ids = useId();
  const say = useScheduleText();
  const preset = presetOf(schedule.cron);
  const presets: readonly Option<SchedulePreset>[] = useMemo(
    () => [
      { label: t`Every morning at 8`, value: "morning" },
      { label: t`Every hour`, value: "hourly" },
      { label: t`Weekdays at 9`, value: "weekdays" },
      { label: t`Mondays at 9`, value: "weekly" },
      { label: t`Every minute (for testing)`, value: "every-minute" },
      { label: t`Custom`, value: "custom" },
    ],
    [t]
  );
  const [custom, setCustom] = useState(preset === "custom");
  const changePreset = useCallback(
    (next: SchedulePreset) => {
      setCustom(next === "custom");
      if (next !== "custom") {
        onChange(index, { ...schedule, cron: PRESET_CRON[next] });
      }
    },
    [index, onChange, schedule]
  );
  const changeCron = useCallback(
    (event: ChangeEvent<HTMLInputElement>) =>
      onChange(index, { ...schedule, cron: event.currentTarget.value }),
    [index, onChange, schedule]
  );
  const changePrompt = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) =>
      onChange(index, { ...schedule, prompt: event.currentTarget.value }),
    [index, onChange, schedule]
  );
  const changeZone = useCallback(
    (event: ChangeEvent<HTMLInputElement>) =>
      onChange(index, { ...schedule, timezone: event.currentTarget.value }),
    [index, onChange, schedule]
  );
  const changeEnabled = useCallback(
    (enabled: boolean) => onChange(index, { ...schedule, enabled }),
    [index, onChange, schedule]
  );
  const remove = useCallback(() => onRemove(index), [index, onRemove]);
  const position = index + 1;
  return (
    <fieldset className="flex flex-col gap-3 rounded-lg border border-border p-3">
      <div className="flex items-center gap-2">
        <OptionSelect
          className="min-w-0 flex-1"
          label={t`When schedule ${position} runs`}
          onChange={changePreset}
          options={presets}
          value={custom ? "custom" : preset}
        />
        <Switch
          aria-label={t`Schedule ${position} on`}
          checked={schedule.enabled}
          onCheckedChange={changeEnabled}
        />
        <Button
          aria-label={t`Remove schedule ${position}`}
          onClick={remove}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <Trash2Icon />
        </Button>
      </div>
      {custom ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor={`${ids}-cron`}>
              <Trans>Cron</Trans>
            </FieldLabel>
            <Input
              autoComplete="off"
              className="font-mono"
              id={`${ids}-cron`}
              onChange={changeCron}
              placeholder="0 8 * * *"
              value={schedule.cron}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${ids}-zone`}>
              <Trans>Time zone</Trans>
            </FieldLabel>
            <Input
              autoComplete="off"
              id={`${ids}-zone`}
              onChange={changeZone}
              value={schedule.timezone}
            />
          </Field>
        </div>
      ) : null}
      <p className="text-muted-foreground text-xs">
        {say(schedule.cron)} · {schedule.timezone}
      </p>
      <Field>
        <FieldLabel htmlFor={`${ids}-prompt`}>
          <Trans>Task</Trans>
        </FieldLabel>
        <Textarea
          id={`${ids}-prompt`}
          onChange={changePrompt}
          placeholder={t`What should it do each time?`}
          required
          rows={2}
          value={schedule.prompt}
        />
      </Field>
    </fieldset>
  );
};

export interface DotDialogProps {
  /** The Dot being edited; absent for a new one. */
  readonly dot?: Dot;
  /** A template to start a new Dot from. */
  readonly initial?: DotDraft;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSaved: (dot: Dot) => void;
  readonly open: boolean;
}

export function DotDialog(props: DotDialogProps) {
  // Remounted per open, so the form starts from the Dot or the template.
  return props.open ? <DotForm {...props} /> : null;
}

function DotForm({
  dot,
  initial,
  onOpenChange,
  onSaved,
  open,
}: DotDialogProps) {
  const { t } = useLingui();
  const ids = useId();
  const { client } = useApi();
  const targets = useTargetOptions();
  const [draft, setDraft] = useState<DotDraft>(
    () =>
      (dot ? draftOf(dot) : initial) ?? {
        autoApproveTools: "",
        instructions: "",
        name: "",
        sandbox: "default",
        schedules: [newSchedule(PRESET_CRON.morning, "")],
        target: "",
      }
  );
  const target =
    draft.target === ""
      ? (targets.find((o) => !o.disabled)?.value ?? "")
      : draft.target;

  const save = useMutation({
    mutationFn: async (): Promise<Dot> => {
      const runTarget = targetOf(target);
      if (!runTarget) {
        throw new Error("no target");
      }
      const fields = {
        autoApproveTools: toolsOf(draft.autoApproveTools),
        instructions: draft.instructions,
        name: draft.name.trim(),
        sandboxProvider: draft.sandbox === "default" ? null : draft.sandbox,
        target: runTarget,
      };
      const scheduleFields = (schedule: ScheduleDraft) => ({
        cron: schedule.cron.trim(),
        enabled: schedule.enabled,
        prompt: schedule.prompt.trim(),
        timezone: schedule.timezone.trim() || "UTC",
      });
      if (!dot) {
        return client.dots.create({
          ...fields,
          enabled: true,
          schedules: draft.schedules.map(scheduleFields),
        });
      }
      await client.dots.update({ id: dot.id, ...fields });
      const kept = new Set(draft.schedules.map((schedule) => schedule.id));
      await Promise.all([
        ...dot.schedules
          .filter((schedule) => !kept.has(schedule.id))
          .map((schedule) => client.dots.deleteSchedule({ id: schedule.id })),
        ...draft.schedules.map((schedule) =>
          schedule.id
            ? client.dots.updateSchedule({
                id: schedule.id,
                ...scheduleFields(schedule),
              })
            : client.dots.createSchedule({
                dotId: dot.id,
                ...scheduleFields(schedule),
              })
        ),
      ]);
      return client.dots.get({ id: dot.id });
    },
    onSuccess: (saved) => {
      onSaved(saved);
      onOpenChange(false);
    },
  });

  const set = useCallback(
    <K extends keyof DotDraft>(key: K, value: DotDraft[K]) =>
      setDraft((current) => ({ ...current, [key]: value })),
    []
  );
  const changeName = useCallback(
    (event: ChangeEvent<HTMLInputElement>) =>
      set("name", event.currentTarget.value),
    [set]
  );
  const changeInstructions = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) =>
      set("instructions", event.currentTarget.value),
    [set]
  );
  const changeTools = useCallback(
    (event: ChangeEvent<HTMLInputElement>) =>
      set("autoApproveTools", event.currentTarget.value),
    [set]
  );
  const changeTarget = useCallback(
    (value: string) => set("target", value),
    [set]
  );
  const changeSandbox = useCallback(
    (value: DotDraft["sandbox"]) => set("sandbox", value),
    [set]
  );
  const changeSchedule = useCallback(
    (index: number, next: ScheduleDraft) =>
      setDraft((current) => ({
        ...current,
        schedules: current.schedules.map((schedule, at) =>
          at === index ? next : schedule
        ),
      })),
    []
  );
  const removeSchedule = useCallback(
    (index: number) =>
      setDraft((current) => ({
        ...current,
        schedules: current.schedules.filter((_, at) => at !== index),
      })),
    []
  );
  const addSchedule = useCallback(
    () =>
      setDraft((current) => ({
        ...current,
        schedules: [
          ...current.schedules,
          newSchedule(PRESET_CRON.hourly, current.schedules[0]?.prompt ?? ""),
        ],
      })),
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

  const sandboxes: readonly Option<DotDraft["sandbox"]>[] = useMemo(
    () => [
      { label: t`Server default`, value: "default" },
      { label: t`Simulated (just-bash)`, value: "just-bash" },
      { label: t`Docker (sandbox runner)`, value: "docker" },
    ],
    [t]
  );

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <form className="contents" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>
              {dot ? <Trans>Edit Dot</Trans> : <Trans>New Dot</Trans>}
            </DialogTitle>
            <DialogDescription>
              <Trans>
                A Dot is an always-on agent with its own chat and workspace. It
                runs on its schedules, and you'll see what it found.
              </Trans>
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={`${ids}-name`}>
                <Trans>Name</Trans>
              </FieldLabel>
              <Input
                autoFocus
                id={`${ids}-name`}
                maxLength={200}
                onChange={changeName}
                placeholder={t`Morning brief`}
                required
                value={draft.name}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${ids}-target`}>
                <Trans>Model or agent</Trans>
              </FieldLabel>
              <OptionSelect
                id={`${ids}-target`}
                onChange={changeTarget}
                options={targets}
                value={target}
              />
              <FieldDescription>
                <Trans>
                  An agent brings its own tools and MCP servers; a model gets
                  the workspace and the server's built-in tools.
                </Trans>
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor={`${ids}-instructions`}>
                <Trans>Instructions</Trans>
              </FieldLabel>
              <Textarea
                id={`${ids}-instructions`}
                maxLength={20_000}
                onChange={changeInstructions}
                placeholder={t`What it's for and how to report back.`}
                rows={3}
                value={draft.instructions}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${ids}-sandbox`}>
                <Trans>Workspace</Trans>
              </FieldLabel>
              <OptionSelect
                id={`${ids}-sandbox`}
                onChange={changeSandbox}
                options={sandboxes}
                value={draft.sandbox}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${ids}-tools`}>
                <Trans>Tools it may use without asking</Trans>
              </FieldLabel>
              <Input
                autoComplete="off"
                className="font-mono"
                id={`${ids}-tools`}
                onChange={changeTools}
                placeholder="write, edit"
                value={draft.autoApproveTools}
              />
              <FieldDescription>
                <Trans>
                  Nobody is there to approve tools while it runs on its own, so
                  any tool that would ask is refused, unless you name it here.
                </Trans>
              </FieldDescription>
            </Field>
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="font-medium text-sm">
                  <Trans>Schedules</Trans>
                </span>
                <Button
                  onClick={addSchedule}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <PlusIcon data-icon="inline-start" />
                  <Trans>Add schedule</Trans>
                </Button>
              </div>
              {draft.schedules.map((schedule, index) => (
                <ScheduleRow
                  index={index}
                  key={schedule.key}
                  onChange={changeSchedule}
                  onRemove={removeSchedule}
                  schedule={schedule}
                />
              ))}
            </div>
            {save.isError ? (
              <FieldError>
                <Trans>
                  It couldn't be saved. Check the schedules' cron and time zone,
                  then try again.
                </Trans>
              </FieldError>
            ) : null}
          </FieldGroup>
          <DialogFooter>
            <Button disabled={save.isPending || target === ""} type="submit">
              {save.isPending ? <Spinner data-icon="inline-start" /> : null}
              {dot ? <Trans>Save</Trans> : <Trans>Create Dot</Trans>}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
