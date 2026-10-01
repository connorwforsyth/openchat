"use client";

import { Plural, useLingui } from "@lingui/react/macro";
import type { SkillUse } from "@workspace/ai/messages/skills";
import { SparklesIcon } from "@workspace/icons";

// Which skills a message used (127): the server keeps them on the stored
// user message, so they show under it after a reload and in a shared chat,
// as they did while it was being sent.

export function SkillsNote({
  skills,
}: {
  readonly skills: readonly SkillUse[];
}) {
  const { i18n } = useLingui();
  const names = new Intl.ListFormat(i18n.locale, {
    style: "short",
    type: "conjunction",
  }).format(skills.map((skill) => skill.name));
  const count = skills.length;
  return (
    <p
      className="flex items-center gap-1.5 text-muted-foreground text-xs"
      data-slot="message-skills"
    >
      <SparklesIcon aria-hidden className="size-3.5" />
      <Plural
        one={`Used the skill ${names}`}
        other={`Used the skills ${names}`}
        value={count}
      />
    </p>
  );
}
