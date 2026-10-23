"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { nextNominal, tooFrequent } from "@workspace/ai/schedules/recurrence";
import { resolveWhen } from "@workspace/ai/schedules/tool";
import {
  formatAt,
  useRecurrenceText,
} from "@workspace/chat-ui/conversation/schedule-text";
import type { ConversationId } from "@workspace/contract/schemas/common";
import {
  DEFAULT_SCHEDULE_EMOJI,
  type Schedule,
  type ScheduleNotify,
  type ScheduleRecurrence,
  type ScheduleTarget,
} from "@workspace/contract/schemas/schedules";
import { ChevronDownIcon } from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible";
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
  FieldLabel,
} from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import { Spinner } from "@workspace/ui/components/spinner";
import { Textarea } from "@workspace/ui/components/textarea";
import { cn } from "@workspace/ui/lib/utils";
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

import { EmojiPicker } from "./emoji-picker";

// Making or editing a scheduled task (183): a title, the task, and "When"
// in plain words ("every weekday at 9am") read back as the rule and the
// next run before you save. The chat's Proposed card is the other way in;
// this is for the schedules page, the chat menu and the Dot's profile.

/** What the editor starts from: a stored schedule, or a template. */
export interface ScheduleSeed {
  readonly emoji?: string;
  readonly notify?: ScheduleNotify;
  readonly prompt: string;
  readonly target?: ScheduleTarget;
  readonly title: string;
  readonly when: string;
}

const browserZone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

const zones = (): readonly string[] => {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return ["UTC"];
  }
};

const emojiOf = (
  schedule: Schedule | null,
  seed: ScheduleSeed | null
): string => schedule?.emoji ?? seed?.emoji ?? DEFAULT_SCHEDULE_EMOJI;

type TargetChoice = "dot" | "chat" | "new";

const choiceOf = (target: ScheduleTarget | undefined): TargetChoice => {
  switch (target?.kind) {
    case "conversation":
      return "chat";
    case "new_chat_each_run":
      return "new";
    default:
      return "dot";
  }
};

type Parsed =
  | { readonly recurrence: ScheduleRecurrence; readonly type: "ok" }
  | {
      readonly type: "error";
      readonly why: "empty" | "unrecognised" | "in_past" | "too_frequent";
    };

export function ScheduleEditor({
  chatId = null,
  hasDot,
  onOpenChange,
  onSaved,
  open,
  schedule = null,
  seed = null,
}: {
  /** The chat it was opened from: offers "This chat" as the target. */
  readonly chatId?: ConversationId | null;
  readonly hasDot: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSaved?: (schedule: Schedule) => void;
  readonly open: boolean;
  /** Edit this one; otherwise make a new one. */
  readonly schedule?: Schedule | null;
  readonly seed?: ScheduleSeed | null;
}) {
  const { i18n, t } = useLingui();
  const ids = useId();
  const { client, query } = useApi();
  const queryClient = useQueryClient();
  const say = useRecurrenceText();
  const limits = useQuery(query.schedules.limits.queryOptions({ input: {} }));
  const [title, setTitle] = useState(schedule?.title ?? seed?.title ?? "");
  const [emoji, setEmoji] = useState(() => emojiOf(schedule, seed));
  const [prompt, setPrompt] = useState(schedule?.prompt ?? seed?.prompt ?? "");
  const [when, setWhen] = useState(seed?.when ?? "");
  const [timezone, setTimezone] = useState(
    schedule?.recurrence.timezone ?? browserZone()
  );
  const [endsOn, setEndsOn] = useState(
    schedule?.recurrence.endsAt?.slice(0, 10) ?? ""
  );
  const [notify, setNotify] = useState<ScheduleNotify>(
    schedule?.notify ?? seed?.notify ?? "important"
  );
  const initialTarget =
    schedule?.target ??
    seed?.target ??
    (chatId ? { conversationId: chatId, kind: "conversation" } : undefined);
  const [target, setTarget] = useState<TargetChoice>(() => {
    const choice = choiceOf(initialTarget);
    return choice === "dot" && !hasDot ? "new" : choice;
  });
  const targetChat =
    initialTarget?.kind === "conversation"
      ? initialTarget.conversationId
      : chatId;

  const parsed: Parsed = useMemo(() => {
    const now = new Date();
    let base: ScheduleRecurrence;
    if (when.trim() === "") {
      if (!schedule) {
        return { type: "error", why: "empty" };
      }
      base = schedule.recurrence;
    } else {
      const read = resolveWhen(when, timezone, now);
      if (!read.ok) {
        return {
          type: "error",
          why: read.error === "in_past" ? "in_past" : "unrecognised",
        };
      }
      base = read.value;
    }
    const recurrence: ScheduleRecurrence = {
      ...base,
      endsAt: endsOn ? new Date(`${endsOn}T23:59:59`).toISOString() : null,
      timezone,
    };
    const min = limits.data?.minIntervalMinutes ?? 60;
    const frequent = tooFrequent(recurrence, now, min);
    if (frequent.ok && frequent.value) {
      return { type: "error", why: "too_frequent" };
    }
    return { recurrence, type: "ok" };
  }, [endsOn, limits.data, schedule, timezone, when]);

  const next = useMemo(() => {
    if (parsed.type !== "ok") {
      return null;
    }
    const first = nextNominal(parsed.recurrence, new Date());
    return first.ok && first.value
      ? formatAt(i18n.locale, first.value.toISOString(), timezone)
      : null;
  }, [i18n.locale, parsed, timezone]);

  const targetValue = (): ScheduleTarget => {
    if (target === "chat" && targetChat) {
      return { conversationId: targetChat, kind: "conversation" };
    }
    return target === "dot" ? { kind: "dot" } : { kind: "new_chat_each_run" };
  };

  const save = useMutation({
    mutationFn: async (runAfter: boolean) => {
      if (parsed.type !== "ok") {
        throw new Error("unparsed");
      }
      const fields = {
        emoji,
        notify,
        prompt: prompt.trim(),
        recurrence: parsed.recurrence,
        target: targetValue(),
        title: title.trim() || t`Scheduled task`,
      };
      const saved = schedule
        ? await client.schedules.update({ id: schedule.id, ...fields })
        : await client.schedules.create({ ...fields });
      if (runAfter) {
        await client.schedules.runNow({ id: saved.id });
      }
      return saved;
    },
    onSuccess: async (saved) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: query.schedules.key() }),
        queryClient.invalidateQueries({ queryKey: query.dots.key() }),
        queryClient.invalidateQueries({ queryKey: query.conversations.key() }),
      ]);
      onSaved?.(saved);
      onOpenChange(false);
    },
  });

  const change =
    (set: (value: string) => void) =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      set(event.currentTarget.value);
  const { mutate } = save;
  const submit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      mutate(false);
    },
    [mutate]
  );
  const saveAndRun = useCallback(() => mutate(true), [mutate]);

  const targets: readonly Option<TargetChoice>[] = [
    ...(hasDot ? [{ label: t`Your Dot's chat`, value: "dot" as const }] : []),
    ...(targetChat ? [{ label: t`This chat`, value: "chat" as const }] : []),
    { label: t`A new chat each run`, value: "new" },
  ];
  const notifyOptions: readonly Option<ScheduleNotify>[] = [
    { label: t`Only when it needs me`, value: "important" },
    { label: t`Every run with news`, value: "all" },
    { label: t`Only if a run fails`, value: "failures" },
    { label: t`Never`, value: "none" },
  ];
  // The parser reads English, so each preset's value stays English while
  // its label is translated.
  const presets = [
    { label: t`Every morning`, when: "every morning at 8" },
    { label: t`Weekdays at 9`, when: "weekdays at 9am" },
    { label: t`Mondays at 9`, when: "every monday at 9am" },
    { label: t`Monthly on the 1st`, when: "every month on the 1st at 9" },
    { label: t`Tomorrow at 9`, when: "tomorrow at 9am" },
  ];
  const min = limits.data?.minIntervalMinutes ?? 60;
  const ready = parsed.type === "ok" && prompt.trim() !== "";

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-lg">
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <EditorHeader editing={schedule !== null} />

          <Field>
            <FieldLabel htmlFor={`${ids}-title`}>
              <Trans>Name</Trans>
            </FieldLabel>
            <div className="flex gap-2">
              <EmojiPicker onChange={setEmoji} value={emoji} />
              <Input
                autoComplete="off"
                id={`${ids}-title`}
                maxLength={80}
                onChange={change(setTitle)}
                placeholder={t`Morning brief`}
                value={title}
              />
            </div>
          </Field>

          <Field>
            <FieldLabel htmlFor={`${ids}-prompt`}>
              <Trans>Task</Trans>
            </FieldLabel>
            <Textarea
              id={`${ids}-prompt`}
              maxLength={4000}
              onChange={change(setPrompt)}
              placeholder={t`What should it do each time?`}
              required
              rows={3}
              value={prompt}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor={`${ids}-when`}>
              <Trans>When</Trans>
            </FieldLabel>
            <Input
              aria-describedby={`${ids}-when-said`}
              autoComplete="off"
              id={`${ids}-when`}
              onChange={change(setWhen)}
              placeholder={
                schedule ? say(schedule.recurrence) : t`every weekday at 9am`
              }
              value={when}
            />
            <div className="flex flex-wrap gap-1.5">
              {presets.map((preset) => (
                <PresetButton
                  active={when === preset.when}
                  key={preset.when}
                  label={preset.label}
                  onPick={setWhen}
                  when={preset.when}
                />
              ))}
            </div>
            <p
              aria-live="polite"
              className={cn(
                "text-xs",
                parsed.type === "ok"
                  ? "text-muted-foreground"
                  : "text-destructive"
              )}
              id={`${ids}-when-said`}
            >
              <WhenFeedback min={min} next={next} parsed={parsed} />
            </p>
          </Field>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor={`${ids}-target`}>
                <Trans>Posts to</Trans>
              </FieldLabel>
              <OptionSelect
                id={`${ids}-target`}
                onChange={setTarget}
                options={targets}
                value={target}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${ids}-notify`}>
                <Trans>Tell me</Trans>
              </FieldLabel>
              <OptionSelect
                id={`${ids}-notify`}
                onChange={setNotify}
                options={notifyOptions}
                value={notify}
              />
            </Field>
          </div>

          <Collapsible>
            <CollapsibleTrigger className="group flex items-center gap-1 text-muted-foreground text-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50">
              <ChevronDownIcon
                aria-hidden
                className="size-4 transition-transform duration-(--motion-fast) ease-motion-out group-data-[panel-open]:rotate-180"
              />
              <Trans>Time zone and end date</Trans>
            </CollapsibleTrigger>
            <CollapsibleContent className="grid grid-cols-1 gap-3 pt-3 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor={`${ids}-zone`}>
                  <Trans>Time zone</Trans>
                </FieldLabel>
                <Input
                  autoComplete="off"
                  id={`${ids}-zone`}
                  list={`${ids}-zones`}
                  onChange={change(setTimezone)}
                  value={timezone}
                />
                <datalist id={`${ids}-zones`}>
                  {zones().map((zone) => (
                    <option key={zone} value={zone} />
                  ))}
                </datalist>
              </Field>
              <Field>
                <FieldLabel htmlFor={`${ids}-ends`}>
                  <Trans>End repeat</Trans>
                </FieldLabel>
                <Input
                  id={`${ids}-ends`}
                  onChange={change(setEndsOn)}
                  type="date"
                  value={endsOn}
                />
                <FieldDescription>
                  <Trans>Leave empty to repeat until you stop it.</Trans>
                </FieldDescription>
              </Field>
            </CollapsibleContent>
          </Collapsible>

          {target === "chat" ? (
            <FieldDescription>
              <Trans>
                Runs in an ordinary chat can read but not change files.
              </Trans>
            </FieldDescription>
          ) : null}
          {save.isError ? (
            <FieldError>
              <Trans>
                It couldn't be saved. Check the fields and try again.
              </Trans>
            </FieldError>
          ) : null}

          <DialogFooter>
            <Button
              disabled={!ready || save.isPending}
              onClick={saveAndRun}
              type="button"
              variant="outline"
            >
              <Trans>Save and run now</Trans>
            </Button>
            <Button disabled={!ready || save.isPending} type="submit">
              {save.isPending ? <Spinner data-icon="inline-start" /> : null}
              <Trans>Save</Trans>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditorHeader({ editing }: { readonly editing: boolean }) {
  return (
    <DialogHeader>
      <DialogTitle>
        {editing ? (
          <Trans>Edit scheduled task</Trans>
        ) : (
          <Trans>New scheduled task</Trans>
        )}
      </DialogTitle>
      <DialogDescription>
        <Trans>
          It runs on its own, with nobody watching, and posts what it finds.
        </Trans>
      </DialogDescription>
    </DialogHeader>
  );
}

function PresetButton({
  active,
  label,
  onPick,
  when,
}: {
  readonly active: boolean;
  readonly label: string;
  readonly onPick: (when: string) => void;
  readonly when: string;
}) {
  const pick = useCallback(() => onPick(when), [onPick, when]);
  return (
    <button
      className={cn(
        "rounded-full border border-border px-2.5 py-0.5 text-muted-foreground text-xs outline-none transition-colors duration-(--motion-fast) hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
        active && "bg-muted text-foreground"
      )}
      onClick={pick}
      type="button"
    >
      {label}
    </button>
  );
}

function WhenFeedback({
  min,
  next,
  parsed,
}: {
  readonly min: number;
  readonly next: string | null;
  readonly parsed: Parsed;
}) {
  const say = useRecurrenceText();
  if (parsed.type === "ok") {
    return (
      <>
        {say(parsed.recurrence)}
        {next ? (
          <>
            {" · "}
            <Trans>first run {next}</Trans>
          </>
        ) : null}
      </>
    );
  }
  switch (parsed.why) {
    case "unrecognised":
      return (
        <Trans>
          Try “every weekday at 9am”, “every 2 hours” or “tomorrow at 8:30”.
        </Trans>
      );
    case "in_past":
      return <Trans>That time has passed. Pick a later one.</Trans>;
    case "too_frequent":
      return (
        <Trans>This instance allows runs every {min} minutes or longer.</Trans>
      );
    default:
      return null;
  }
}
