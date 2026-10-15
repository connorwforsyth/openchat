import type { SkillOption } from "@workspace/composer/schemas";
import { describe, expect, it } from "vitest";

import { startFill } from "./start-fill";

const skill = {
  description: "",
  id: "0190a000-0000-7000-8000-000000000001",
  name: "Brand voice",
  source: "mine",
} as SkillOption;

describe("startFill", () => {
  it("fills a draft without waiting for anything", () => {
    expect(startFill({ draft: "Help me", skillId: null, skills: [] })).toEqual({
      id: 1,
      text: "Help me",
    });
  });

  it("waits for the skill list, then puts the skill on as a chip", () => {
    expect(
      startFill({ draft: null, skillId: skill.id, skills: [] })
    ).toBeUndefined();
    expect(
      startFill({ draft: null, skillId: skill.id, skills: [skill] })
    ).toEqual({
      id: 1,
      skills: [{ id: skill.id, name: "Brand voice" }],
      text: "",
    });
  });

  it("leaves off a skill the person can't use", () => {
    const other = {
      ...skill,
      id: "0190a000-0000-7000-8000-000000000002",
    } as SkillOption;
    expect(
      startFill({ draft: null, skillId: skill.id, skills: [other] })
    ).toBeUndefined();
    expect(
      startFill({ draft: null, skillId: null, skills: [] })
    ).toBeUndefined();
  });
});
