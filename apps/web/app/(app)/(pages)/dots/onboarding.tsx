"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  Dot,
  DotAvatar as DotAvatarValue,
} from "@workspace/contract/schemas/dots";
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon } from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import { Spinner } from "@workspace/ui/components/spinner";
import { Textarea } from "@workspace/ui/components/textarea";
import {
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
  useCallback,
  useId,
  useMemo,
  useState,
} from "react";

import { useApi } from "@/app/(app)/_shared/api";
import { OptionSelect } from "@/app/(app)/_shared/option-select";

import { AvatarPicker } from "./avatar-picker";
import { DOT_AVATAR_COLORS, DOT_AVATAR_STYLES, DotAvatar } from "./dot-avatar";
import { targetOf, useTargetOptions } from "./dot-dialog";
import { localTimeZone } from "./schedule";
import { useScheduleText } from "./schedule-text";
import {
  createInputOf,
  DOT_TEMPLATE_IDS,
  type DotTemplateId,
  type DotTemplateText,
  type OnboardingDraft,
  suggestedAvatar,
  TEMPLATE_CRON,
} from "./templates";

// Making a Dot (172): not a form with a cron in it, but three short steps
// (what to call it, how it looks, what it should help with), then straight
// into its chat. The first one you make is your primary Dot. Steps change
// instantly; only the avatar breathes.

type Step = "name" | "look" | "purpose";
const STEPS: readonly Step[] = ["name", "look", "purpose"];

const useTemplates = (): Readonly<
  Record<DotTemplateId, DotTemplateText & { readonly label: string }>
> => {
  const { t } = useLingui();
  return useMemo(
    () => ({
      "daily-brief": {
        label: t`Daily brief`,
        purpose: t`Brief me every morning: what's on today, what changed overnight, and the one thing to do first.`,
        task: t`Give me my daily brief: what's on today, anything new since yesterday, and the one thing to do first. Three bullets at most.`,
      },
      "follow-up": {
        label: t`Follow-up monitor`,
        purpose: t`Keep track of what I'm waiting on and nudge me when something needs a follow-up.`,
        task: t`Check what I'm waiting on and tell me which items need a follow-up today, and what to say.`,
      },
      "weekly-review": {
        label: t`Weekly review`,
        purpose: t`Help me look back on my week and plan the next one.`,
        task: t`Run my weekly review: what got done, what slipped, and three priorities for next week.`,
      },
    }),
    [t]
  );
};

type Template = DotTemplateText & { readonly label: string };

function StepHeading({
  first,
  name,
  step,
}: {
  readonly first: boolean;
  readonly name: string;
  readonly step: Step;
}) {
  switch (step) {
    case "name":
      return first ? <Trans>Meet your Dot</Trans> : <Trans>A new Dot</Trans>;
    case "look":
      return <Trans>How should {name} look?</Trans>;
    case "purpose":
      return <Trans>What should {name} help with?</Trans>;
    default:
      return step satisfies never;
  }
}

function StepLead({ step }: { readonly step: Step }) {
  switch (step) {
    case "name":
      return (
        <Trans>
          A Dot is an agent that's always on: talk to it like a person, and it
          keeps working when you're away.
        </Trans>
      );
    case "look":
      return (
        <Trans>Pick a shape and a colour. You can change them later.</Trans>
      );
    case "purpose":
      return (
        <Trans>Say it in your own words, or start from a suggestion.</Trans>
      );
    default:
      return step satisfies never;
  }
}

function TemplateButton({
  id,
  onPick,
  picked,
  template,
}: {
  readonly id: DotTemplateId;
  readonly onPick: (id: DotTemplateId) => void;
  readonly picked: boolean;
  readonly template: Template;
}) {
  const pick = useCallback(() => onPick(id), [id, onPick]);
  return (
    <Button
      aria-pressed={picked}
      onClick={pick}
      size="sm"
      type="button"
      variant={picked ? "secondary" : "outline"}
    >
      {template.label}
    </Button>
  );
}

function NameStep({
  first,
  onChange,
  value,
}: {
  readonly first: boolean;
  readonly onChange: (name: string) => void;
  readonly value: string;
}) {
  const { t } = useLingui();
  const ids = useId();
  const change = useCallback(
    (event: ChangeEvent<HTMLInputElement>) =>
      onChange(event.currentTarget.value),
    [onChange]
  );
  return (
    <Field>
      <FieldLabel htmlFor={`${ids}-name`}>
        <Trans>Name</Trans>
      </FieldLabel>
      <Input
        autoComplete="off"
        autoFocus
        id={`${ids}-name`}
        maxLength={24}
        onChange={change}
        placeholder={t`Pip`}
        required
        value={value}
      />
      <FieldDescription>
        {first ? (
          <Trans>Your primary Dot opens from the top of the sidebar.</Trans>
        ) : (
          <Trans>A short name, like a nickname.</Trans>
        )}
      </FieldDescription>
    </Field>
  );
}

function PurposeStep({
  error,
  keepSchedule,
  noModel,
  onKeepSchedule,
  onPick,
  onPurpose,
  onTarget,
  purpose,
  target,
  template,
  templates,
}: {
  readonly error: ReactNode;
  readonly keepSchedule: boolean;
  readonly noModel: boolean;
  readonly onKeepSchedule: (keep: boolean) => void;
  readonly onPick: (id: DotTemplateId) => void;
  readonly onPurpose: (purpose: string) => void;
  readonly onTarget: (target: string) => void;
  readonly purpose: string;
  readonly target: string;
  readonly template: DotTemplateId | null;
  readonly templates: Readonly<Record<DotTemplateId, Template>>;
}) {
  const { t } = useLingui();
  const ids = useId();
  const say = useScheduleText();
  const targets = useTargetOptions();
  const changePurpose = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) =>
      onPurpose(event.currentTarget.value),
    [onPurpose]
  );
  const toggle = useCallback(
    (event: ChangeEvent<HTMLInputElement>) =>
      onKeepSchedule(event.currentTarget.checked),
    [onKeepSchedule]
  );
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {DOT_TEMPLATE_IDS.map((id) => (
          <TemplateButton
            id={id}
            key={id}
            onPick={onPick}
            picked={template === id}
            template={templates[id]}
          />
        ))}
      </div>
      <Field>
        <FieldLabel htmlFor={`${ids}-purpose`}>
          <Trans>What it helps with</Trans>
        </FieldLabel>
        <Textarea
          id={`${ids}-purpose`}
          maxLength={20_000}
          onChange={changePurpose}
          placeholder={t`Keep me on top of my inbox and tell me what needs me.`}
          rows={3}
          value={purpose}
        />
      </Field>
      {template ? (
        <label className="flex items-start gap-2 text-sm">
          <input
            checked={keepSchedule}
            className="mt-0.5 size-4 accent-primary"
            onChange={toggle}
            type="checkbox"
          />
          <span>
            <Trans>Also check in {say(TEMPLATE_CRON[template])}</Trans>
          </span>
        </label>
      ) : null}
      {targets.length > 1 ? (
        <Field>
          <FieldLabel htmlFor={`${ids}-target`}>
            <Trans>Thinks with</Trans>
          </FieldLabel>
          <OptionSelect
            id={`${ids}-target`}
            onChange={onTarget}
            options={targets}
            value={target}
          />
        </Field>
      ) : null}
      {error}
      {noModel ? (
        <FieldError>
          <Trans>No model is available yet. Ask your admin to add one.</Trans>
        </FieldError>
      ) : null}
    </>
  );
}

export interface DotOnboardingProps {
  /** How many Dots the owner has: the first is primary, and looks vary. */
  readonly existing: number;
  /** After it's made: the screen opens its chat. */
  readonly onCreated: (dot: Dot) => void;
}

export function DotOnboarding({ existing, onCreated }: DotOnboardingProps) {
  const { t } = useLingui();
  const ids = useId();
  const { client, query } = useApi();
  const queryClient = useQueryClient();
  const templates = useTemplates();
  const targets = useTargetOptions();
  const [step, setStep] = useState<Step>("name");
  const [template, setTemplate] = useState<DotTemplateId | null>(null);
  const [keepSchedule, setKeepSchedule] = useState(true);
  const [target, setTarget] = useState("");
  const [draft, setDraft] = useState<Omit<OnboardingDraft, "schedule">>(() => ({
    avatar: suggestedAvatar(existing, DOT_AVATAR_STYLES, DOT_AVATAR_COLORS),
    name: "",
    purpose: "",
  }));
  const chosenTarget =
    target === ""
      ? (targets.find((option) => !option.disabled)?.value ?? "")
      : target;
  const first = existing === 0;
  const trimmed = draft.name.trim();
  const name = trimmed === "" ? t`your Dot` : trimmed;

  const create = useMutation({
    mutationFn: () => {
      const runTarget = targetOf(chosenTarget);
      if (!runTarget) {
        return Promise.reject(new Error("no model"));
      }
      const schedule =
        template && keepSchedule
          ? {
              cron: TEMPLATE_CRON[template],
              prompt: templates[template].task,
              timezone: localTimeZone(),
            }
          : null;
      return client.dots.create(
        createInputOf({ ...draft, schedule }, runTarget, first)
      );
    },
    onSuccess: async (dot) => {
      await queryClient.invalidateQueries({ queryKey: query.dots.key() });
      onCreated(dot);
    },
  });

  const setName = useCallback(
    (value: string) => setDraft((current) => ({ ...current, name: value })),
    []
  );
  const setPurpose = useCallback((value: string) => {
    setDraft((current) => ({ ...current, purpose: value }));
    setTemplate(null);
  }, []);
  const setAvatar = useCallback(
    (avatar: DotAvatarValue) => setDraft((current) => ({ ...current, avatar })),
    []
  );
  const pickTemplate = useCallback(
    (id: DotTemplateId) => {
      setTemplate(id);
      setKeepSchedule(true);
      setDraft((current) => ({ ...current, purpose: templates[id].purpose }));
    },
    [templates]
  );

  const index = STEPS.indexOf(step);
  const back = useCallback(() => {
    const previous = STEPS[index - 1];
    if (previous) {
      setStep(previous);
    }
  }, [index]);
  const { mutate } = create;
  const submit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const next = STEPS[index + 1];
      if (next) {
        setStep(next);
      } else {
        mutate();
      }
    },
    [index, mutate]
  );
  const position = index + 1;
  const total = STEPS.length;
  const last = step === "purpose";

  return (
    <form
      aria-labelledby={`${ids}-title`}
      className="mx-auto flex w-full max-w-md flex-col items-center gap-6 py-6 text-center"
      onSubmit={submit}
    >
      <DotAvatar avatar={draft.avatar} size="xl" />
      <div className="flex flex-col gap-1">
        <h1 className="font-semibold text-2xl" id={`${ids}-title`}>
          <StepHeading first={first} name={name} step={step} />
        </h1>
        <p className="text-muted-foreground text-sm">
          <StepLead step={step} />
        </p>
        <p className="text-muted-foreground text-xs">
          <Trans>
            Step {position} of {total}
          </Trans>
        </p>
      </div>

      <div className="flex w-full flex-col gap-4 text-start">
        {step === "name" ? (
          <NameStep first={first} onChange={setName} value={draft.name} />
        ) : null}
        {step === "look" ? (
          <AvatarPicker onChange={setAvatar} value={draft.avatar} />
        ) : null}
        {last ? (
          <PurposeStep
            error={
              create.isError ? (
                <FieldError>
                  <Trans>{name} couldn't be made. Try again.</Trans>
                </FieldError>
              ) : null
            }
            keepSchedule={keepSchedule}
            noModel={chosenTarget === ""}
            onKeepSchedule={setKeepSchedule}
            onPick={pickTemplate}
            onPurpose={setPurpose}
            onTarget={setTarget}
            purpose={draft.purpose}
            target={chosenTarget}
            template={template}
            templates={templates}
          />
        ) : null}
      </div>

      <div className="flex w-full items-center justify-between gap-2">
        {index > 0 ? (
          <Button onClick={back} type="button" variant="ghost">
            <ArrowLeftIcon
              className="rtl:-scale-x-100"
              data-icon="inline-start"
            />
            <Trans>Back</Trans>
          </Button>
        ) : (
          <span />
        )}
        {last ? (
          <Button
            disabled={create.isPending || chosenTarget === ""}
            type="submit"
          >
            {create.isPending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <CheckIcon data-icon="inline-start" />
            )}
            <Trans>Say hi to {name}</Trans>
          </Button>
        ) : (
          <Button disabled={trimmed === ""} type="submit">
            <Trans>Next</Trans>
            <ArrowRightIcon
              className="rtl:-scale-x-100"
              data-icon="inline-end"
            />
          </Button>
        )}
      </div>
    </form>
  );
}
