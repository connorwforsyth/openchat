import { agentItem, fixtureId } from "@workspace/contract/fixtures";
import type { LibraryItem } from "@workspace/contract/schemas/library";
import { describe, expect, it } from "vitest";

import { usableSkills } from "./usable-skills";

const item = (n: number, patch: Partial<LibraryItem> = {}): LibraryItem => ({
  ...agentItem,
  description: `Skill ${n} does a thing.`,
  id: fixtureId("libraryItem", n),
  kind: "skill",
  name: `Skill ${n}`,
  ...patch,
});

describe("usableSkills", () => {
  it("lists published skills once, from the first tab that has them, and the person's own drafts", () => {
    expect(
      usableSkills([
        {
          items: [item(1), item(2, { latestVersionId: null })],
          source: "mine",
        },
        { items: [item(3), item(1)], source: "shared" },
        { items: [item(4), item(5, { kind: "agent" })], source: "libraries" },
      ]).map((skill) => [skill.name, skill.source, skill.draftVersion])
    ).toEqual([
      ["Skill 1", "mine", undefined],
      ["Skill 2", "mine", agentItem.draftVersionId],
      ["Skill 3", "shared", undefined],
      ["Skill 4", "libraries", undefined],
    ]);
  });
});
