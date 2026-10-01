"use client";

import { useLingui } from "@lingui/react/macro";
import { SparklesIcon, XIcon } from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import { useCallback } from "react";

import type { PickedSkillOption } from "../schemas";

// The skills picked for the next message (127), as chips beside its
// attachments. Each goes with the message; × takes it off again.

export interface SkillListProps {
  readonly disabled?: boolean;
  readonly onRemove: (id: PickedSkillOption["id"]) => void;
  readonly skills: readonly PickedSkillOption[];
}

function SkillChip({
  disabled,
  onRemove,
  skill,
}: {
  readonly disabled: boolean | undefined;
  readonly onRemove: SkillListProps["onRemove"];
  readonly skill: PickedSkillOption;
}) {
  const { t } = useLingui();
  const { id, name } = skill;
  const remove = useCallback(() => onRemove(id), [id, onRemove]);
  return (
    <li
      className="flex h-8 max-w-56 items-center gap-1.5 rounded-md border border-border bg-background ps-2 pe-0.5 text-foreground text-sm"
      data-slot="composer-skill"
    >
      <SparklesIcon aria-hidden className="size-4 text-muted-foreground" />
      <span className="truncate">{name}</span>
      <Button
        aria-label={t`Remove skill ${name}`}
        disabled={disabled}
        onClick={remove}
        size="icon-xs"
        type="button"
        variant="ghost"
      >
        <XIcon aria-hidden />
      </Button>
    </li>
  );
}

export function SkillList({ disabled, onRemove, skills }: SkillListProps) {
  const { t } = useLingui();
  if (skills.length === 0) {
    return null;
  }
  return (
    <ul aria-label={t`Skills`} className="flex flex-wrap gap-1.5">
      {skills.map((skill) => (
        <SkillChip
          disabled={disabled}
          key={skill.id}
          onRemove={onRemove}
          skill={skill}
        />
      ))}
    </ul>
  );
}
