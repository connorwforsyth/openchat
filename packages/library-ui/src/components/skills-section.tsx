"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import type { LibraryItemId } from "@workspace/contract/schemas/common";
import type { AgentDefinition } from "@workspace/contract/schemas/library";
import { PencilIcon, PlusIcon, SparklesIcon, XIcon } from "@workspace/icons";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@workspace/ui/components/command";
import {
  FieldDescription,
  FieldGroup,
  FieldLegend,
  FieldSet,
} from "@workspace/ui/components/field";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover";
import { Spinner } from "@workspace/ui/components/spinner";
import { type FormEvent, useCallback, useState } from "react";

import type { Choice } from "./agent-form";
import { SnippetField, TextField } from "./fields";

// The agent's skills: what's attached, a picker over the library, and an
// inline form to write a new one, which is saved as the writer's own draft
// and attached at once.

/** What "Write a skill" collects. */
export interface NewSkill {
  readonly description: string;
  readonly instructions: string;
  readonly name: string;
}

export interface SkillsSectionProps {
  readonly attached: AgentDefinition["skills"];
  readonly onAttach: (id: LibraryItemId) => void;
  /** Saves a new skill; `null` when it couldn't be. Without it there's no "Write a skill". */
  readonly onCreate?: (skill: NewSkill) => Promise<Choice | null>;
  readonly onDetach: (id: LibraryItemId) => void;
  readonly readOnly: boolean;
  /** Skills the caller can use. */
  readonly skills: readonly Choice[];
}

export function SkillsSection({
  attached,
  onAttach,
  onCreate,
  onDetach,
  readOnly,
  skills,
}: SkillsSectionProps) {
  const { t } = useLingui();
  const [writing, setWriting] = useState(false);
  // A skill written here is attached before the library lists it.
  const [written, setWritten] = useState<readonly Choice[]>([]);
  const known = [...skills, ...written];
  const choiceFor = (id: LibraryItemId) =>
    known.find((skill) => skill.id === id);
  const available = skills.filter(
    (skill) => !attached.some((each) => each.id === skill.id)
  );
  const startWriting = useCallback(() => setWriting(true), []);
  const stopWriting = useCallback(() => setWriting(false), []);
  const created = useCallback(
    (skill: Choice) => {
      setWritten((current) => [...current, skill]);
      onAttach(skill.id);
      setWriting(false);
    },
    [onAttach]
  );

  return (
    <FieldSet>
      <FieldLegend variant="label">
        <Trans>Skills</Trans>
      </FieldLegend>
      <FieldDescription>
        <Trans>
          The agent loads these when a task calls for them. Type / in the
          instructions to mention one.
        </Trans>
      </FieldDescription>
      {attached.length > 0 ? (
        <ul aria-label={t`Attached skills`} className="flex flex-col gap-1">
          {attached.map((skill) => (
            <SkillRow
              choice={choiceFor(skill.id)}
              id={skill.id}
              key={skill.id}
              onRemove={readOnly ? undefined : onDetach}
            />
          ))}
        </ul>
      ) : null}
      {readOnly ? null : (
        <div className="flex flex-wrap gap-2">
          <AddSkill onAttach={onAttach} skills={available} />
          {onCreate && !writing ? (
            <Button onClick={startWriting} size="sm" variant="outline">
              <PencilIcon data-icon="inline-start" />
              <Trans>Write a skill</Trans>
            </Button>
          ) : null}
        </div>
      )}
      {onCreate && writing && !readOnly ? (
        <WriteSkill
          onCancel={stopWriting}
          onCreate={onCreate}
          onCreated={created}
        />
      ) : null}
    </FieldSet>
  );
}

function SkillRow({
  choice,
  id,
  onRemove,
}: {
  readonly choice: Choice | undefined;
  readonly id: LibraryItemId;
  readonly onRemove?: (id: LibraryItemId) => void;
}) {
  const { t } = useLingui();
  const name = choice?.name ?? t`A skill you can't see`;
  const remove = useCallback(() => onRemove?.(id), [id, onRemove]);
  return (
    <li className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-2 text-sm">
      <SparklesIcon className="size-4 shrink-0 text-muted-foreground" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-2">
          <span className="truncate font-medium">{name}</span>
          {choice && !choice.published ? (
            <Badge variant="outline">
              <Trans>Draft</Trans>
            </Badge>
          ) : null}
        </span>
        {choice?.description ? (
          <span className="truncate text-muted-foreground text-xs">
            {choice.description}
          </span>
        ) : null}
      </div>
      {onRemove ? (
        <Button
          aria-label={t`Remove ${name}`}
          onClick={remove}
          size="icon-xs"
          variant="ghost"
        >
          <XIcon />
        </Button>
      ) : null}
    </li>
  );
}

function AddSkill({
  onAttach,
  skills,
}: {
  readonly onAttach: (id: LibraryItemId) => void;
  readonly skills: readonly Choice[];
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const pick = useCallback(
    (id: string) => {
      onAttach(id as LibraryItemId);
      setOpen(false);
    },
    [onAttach]
  );
  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger render={<Button size="sm" variant="outline" />}>
        <PlusIcon data-icon="inline-start" />
        <Trans>Add skill</Trans>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <Command>
          <CommandInput
            aria-label={t`Find a skill`}
            placeholder={t`Find a skill`}
          />
          <CommandList>
            <CommandEmpty>
              <Trans>No skills to add.</Trans>
            </CommandEmpty>
            {skills.map((skill) => (
              <SkillOption key={skill.id} onPick={pick} skill={skill} />
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function SkillOption({
  onPick,
  skill,
}: {
  readonly onPick: (id: string) => void;
  readonly skill: Choice;
}) {
  const select = useCallback(() => onPick(skill.id), [onPick, skill.id]);
  return (
    <CommandItem
      keywords={[skill.name, skill.description]}
      onSelect={select}
      value={skill.id}
    >
      <SparklesIcon />
      <span className="flex min-w-0 flex-col">
        <span className="truncate">{skill.name}</span>
        {skill.description ? (
          <span className="truncate text-muted-foreground text-xs">
            {skill.description}
          </span>
        ) : null}
      </span>
    </CommandItem>
  );
}

function WriteSkill({
  onCancel,
  onCreate,
  onCreated,
}: {
  readonly onCancel: () => void;
  readonly onCreate: (skill: NewSkill) => Promise<Choice | null>;
  readonly onCreated: (skill: Choice) => void;
}) {
  const { t } = useLingui();
  const [skill, setSkill] = useState<NewSkill>({
    description: "",
    instructions: "",
    name: "",
  });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const setField = useCallback(
    (value: string, field: string) =>
      setSkill((current) => ({ ...current, [field]: value })),
    []
  );
  const setInstructions = useCallback(
    (instructions: string) =>
      setSkill((current) => ({ ...current, instructions })),
    []
  );
  const ready =
    skill.name.trim() !== "" &&
    skill.description.trim() !== "" &&
    skill.instructions.trim() !== "";
  const submit = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      if (!ready || busy) {
        return;
      }
      setBusy(true);
      setProblem(null);
      onCreate(skill)
        .then((created) => {
          if (created) {
            onCreated(created);
          } else {
            setProblem(t`The skill couldn't be saved. Try again.`);
          }
        })
        .catch(() => setProblem(t`The skill couldn't be saved. Try again.`))
        .finally(() => setBusy(false));
    },
    [busy, onCreate, onCreated, ready, skill, t]
  );

  return (
    <form
      aria-label={t`New skill`}
      className="flex flex-col gap-4 rounded-lg border border-border p-3"
      onSubmit={submit}
    >
      <FieldGroup>
        <TextField
          label={t`Skill name`}
          name="name"
          onValueChange={setField}
          placeholder={t`Release notes`}
          value={skill.name}
        />
        <TextField
          description={t`When the agent should use it. The agent reads this to decide.`}
          label={t`When to use it`}
          name="description"
          onValueChange={setField}
          placeholder={t`Use when writing release notes from a list of changes.`}
          value={skill.description}
        />
        <SnippetField
          className="min-h-32 font-mono text-sm"
          label={t`Skill instructions`}
          onValueChange={setInstructions}
          spellCheck={false}
          value={skill.instructions}
        />
      </FieldGroup>
      {problem ? (
        <p className="text-destructive text-sm" role="alert">
          {problem}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={!ready || busy} size="sm" type="submit">
          {busy ? <Spinner data-icon="inline-start" /> : null}
          <Trans>Create and attach</Trans>
        </Button>
        <Button onClick={onCancel} size="sm" type="button" variant="ghost">
          <Trans>Cancel</Trans>
        </Button>
        <span className="text-muted-foreground text-xs">
          <Trans>It's saved as your own draft until you publish it.</Trans>
        </span>
      </div>
    </form>
  );
}
