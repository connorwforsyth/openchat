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
  it("lists published skills once, from the first tab that has them", () => {
    expect(
      usableSkills([
        {
          items: [item(1), item(2, { latestVersionId: null })],
          source: "mine",
        },
        { items: [item(3), item(1)], source: "shared" },
        { items: [item(4), item(5, { kind: "agent" })], source: "libraries" },
      ]).map((skill) => [skill.name, skill.source])
    ).toEqual([
      ["Skill 1", "mine"],
      ["Skill 3", "shared"],
      ["Skill 4", "libraries"],
    ]);
  });
});
