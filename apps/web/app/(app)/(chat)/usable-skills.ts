import type { SkillOption } from "@workspace/composer/schemas";

import { type TabItems, usableItems } from "./usable-items";

// The skills a person can pick for a message (127), for the composer's +
// menu and `/` (see `usableItems`): a turn reads a published version, or
// the owner's draft. Pure.

export const usableSkills = (
  lists: readonly TabItems[]
): readonly SkillOption[] =>
  usableItems(lists, "skill").map(({ draftVersion, item, source }) => ({
    description: item.description,
    id: item.id,
    name: item.name,
    source,
    ...(draftVersion ? { draftVersion } : {}),
  }));
