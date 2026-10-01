import type { AgentSource, SkillOption } from "@workspace/composer/schemas";
import type { LibraryItem } from "@workspace/contract/schemas/library";

// The skills a person can pick for a message (127), for the composer's +
// menu and `/`: their own, those shared with them, and those in their
// teams' and orgs' libraries, each once, in that order. Like agents, only
// published skills are offered: a turn reads a published version. Pure.

export const usableSkills = (
  lists: readonly {
    readonly items: readonly LibraryItem[];
    readonly source: AgentSource;
  }[]
): readonly SkillOption[] => {
  const skills: SkillOption[] = [];
  for (const { items, source } of lists) {
    for (const item of items) {
      if (
        item.kind !== "skill" ||
        item.latestVersionId === null ||
        skills.some((skill) => skill.id === item.id)
      ) {
        continue;
      }
      skills.push({
        description: item.description,
        id: item.id,
        name: item.name,
        source,
      });
    }
  }
  return skills;
};
