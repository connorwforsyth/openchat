import type { ComposerFill } from "@workspace/composer/props";
import type { SkillOption } from "@workspace/composer/schemas";

// What a new chat's composer starts with, from its address (170): `?draft=`
// is text to finish and send, `?skill=` a skill to try as a chip. Nothing
// is sent. A skill waits for the skill list, so the chip carries its name;
// one the person can't use (unpublished, not shared) is left off. Pure.

/** The one fill a new chat gets; later fills (138) count up from it. */
export const START_FILL_ID = 1;

export const startFill = ({
  draft,
  skillId,
  skills,
}: {
  readonly draft: string | null;
  readonly skillId: string | null;
  /** Empty while the lists load. */
  readonly skills: readonly SkillOption[];
}): ComposerFill | undefined => {
  if (!(draft || skillId)) {
    return;
  }
  if (skillId && skills.length === 0) {
    return;
  }
  const skill = skillId
    ? skills.find((each) => each.id === skillId)
    : undefined;
  if (!(draft || skill)) {
    return;
  }
  return {
    id: START_FILL_ID,
    ...(skill ? { skills: [{ id: skill.id, name: skill.name }] } : {}),
    text: draft ?? "",
  };
};
