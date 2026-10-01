import type {
  LibraryItemId,
  LibraryVersionId,
} from "@workspace/contract/schemas/common";
import { describe, expect, it } from "vitest";

import { composeInstructions } from "./compose";
import {
  availableSkillsSection,
  type LoadedSkill,
  parseSkillMd,
  pickedSkillSection,
  skillSections,
} from "./skills";

const SKILL_SOURCE = /^skill:/;

const skill = (overrides: Partial<LoadedSkill> = {}): LoadedSkill => ({
  description: "Writes release notes.",
  files: [],
  id: "11111111-1111-4111-8111-111111111111" as LibraryItemId,
  instructions: "Group changes by area. MARKER-RELEASE",
  name: "Release notes",
  versionId: "22222222-2222-4222-8222-222222222222" as LibraryVersionId,
  ...overrides,
});

describe("parseSkillMd", () => {
  it("reads the name and description and keeps the body", () => {
    expect(
      parseSkillMd(
        '---\nname: release-notes\ndescription: "Writes notes: short"\nlicense: MIT\n---\n\n# Notes\nDo it.\n'
      )
    ).toEqual({
      body: "# Notes\nDo it.",
      description: "Writes notes: short",
      name: "release-notes",
    });
  });

  it("treats a file without frontmatter as all body", () => {
    expect(parseSkillMd("  Just do it.\n")).toEqual({ body: "Just do it." });
  });

  it("leaves empty fields out", () => {
    expect(parseSkillMd("---\nname: \ndescription: \n---\n\nBody")).toEqual({
      body: "Body",
    });
  });
});

describe("pickedSkillSection", () => {
  it("wraps the instructions and names the version it came from", () => {
    const section = pickedSkillSection(skill());
    expect(section.source).toBe(
      "skill:11111111-1111-4111-8111-111111111111@22222222-2222-4222-8222-222222222222"
    );
    expect(section.text).toContain('<skill name="Release notes">');
    expect(section.text).toContain("MARKER-RELEASE");
    expect(section.text).not.toContain("load_skill");
  });

  it("lists bundled files and how to read them", () => {
    const section = pickedSkillSection(
      skill({ files: ["templates/notes.md", "scripts/run.sh"] })
    );
    expect(section.text).toContain("`load_skill`");
    expect(section.text).toContain("- templates/notes.md\n- scripts/run.sh");
  });
});

describe("availableSkillsSection", () => {
  it("lists names and descriptions, and is absent without skills", () => {
    expect(availableSkillsSection([])).toBeUndefined();
    const section = availableSkillsSection([
      skill(),
      skill({ description: " ", name: "Bare" }),
    ]);
    expect(section?.source).toBe("fragments/skills.md");
    expect(section?.text).toContain("- Release notes: Writes release notes.");
    expect(section?.text).toContain("- Bare: Bare");
    expect(section?.text).not.toContain("MARKER-RELEASE");
  });
});

describe("skillSections", () => {
  it("puts picks in whole and lists only the agent's skills not picked", () => {
    const other = skill({
      id: "33333333-3333-4333-8333-333333333333" as LibraryItemId,
      instructions: "Other body",
      name: "Other",
    });
    const sections = skillSections({
      attached: [skill(), other],
      picked: [skill()],
    });
    expect(sections.map((section) => section.source)).toEqual([
      expect.stringMatching(SKILL_SOURCE),
      "fragments/skills.md",
    ]);
    const { text } = composeInstructions({ skills: sections });
    expect(text).toContain("MARKER-RELEASE");
    expect(text).toContain("- Other: Writes release notes.");
    expect(text).not.toContain("Other body");
    expect(text).not.toContain("- Release notes:");
  });

  it("is empty with no skills", () => {
    expect(skillSections({ attached: [], picked: [] })).toEqual([]);
  });
});
