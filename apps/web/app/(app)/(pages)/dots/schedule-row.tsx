"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import type { DotScheduleId } from "@workspace/contract/schemas/common";
import { Trash2Icon } from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import { Field, FieldLabel } from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import { Switch } from "@workspace/ui/components/switch";
import { Textarea } from "@workspace/ui/components/textarea";
import { type ChangeEvent, useCallback, useId, useMemo, useState } from "react";

import { type Option, OptionSelect } from "@/app/(app)/_shared/option-select";

import {
  localTimeZone,
  PRESET_CRON,
  presetOf,
  type SchedulePreset,
} from "./schedule";
import { useScheduleText } from "./schedule-text";

// One schedule being written (172): friendly presets, a custom cron and
// zone, and the task it posts. The profile's Scheduled tab edits with it.

export interface ScheduleDraft {
  readonly cron: string;
  readonly enabled: boolean;
  /** The stored schedule this edits; `null` for a new one. */
  readonly id: DotScheduleId | null;
  /** A stable React key, also for new rows. */
  readonly key: string;
  readonly prompt: string;
  readonly timezone: string;
}

let rowSeq = 0;
const rowKey = () => {
  rowSeq += 1;
  return `row-${rowSeq}`;
};

export const newSchedule = (cron: string, prompt: string): ScheduleDraft => ({
  cron,
  enabled: true,
  id: null,
  key: rowKey(),
  prompt,
  timezone: localTimeZone(),
});

export const ScheduleRow = ({
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
