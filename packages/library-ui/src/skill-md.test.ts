import { describe, expect, it } from "vitest";

import { newDefinition, syncSkillItem, validateDraft } from "./form";
import {
  frontmatterValue,
  readSkillMd,
  skillFieldIssues,
  withSkillField,
  writeSkillMd,
} from "./skill-md";

describe("readSkillMd and writeSkillMd", () => {
  it("round-trips fields through SKILL.md exactly", () => {
    const cases = [
      { description: "", instructions: "", name: "" },
      {
        description: "Reviews code. Use when asked to review a diff.",
        instructions: "# Review\n\n1. Read it.\n2. Say what's wrong.\n",
        name: "Code review",
      },
      {
        description: 'Quotes "and" colons: everywhere # here',
        instructions: "\n\nLeading blank lines stay.",
        name: "yes",
      },
      {
        description: "Line one\nline two",
        instructions: "---\nnot frontmatter\n---\n",
        name: " padded ",
      },
    ];
    for (const fields of cases) {
      const read = readSkillMd(writeSkillMd(fields));
      expect(read).toEqual({
        ...fields,
        // A description is one line in the frontmatter.
        description: fields.description.replace(/\n/g, " "),
        extra: [],
      });
    }
  });

  it("writes canonical SKILL.md back unchanged", () => {
    const skillMd =
      "---\nname: Brand voice\ndescription: Our voice. Use for copy.\nlicense: MIT\n---\n\n# Voice\n";
    expect(writeSkillMd(readSkillMd(skillMd))).toBe(skillMd);
  });

  it("keeps other frontmatter when a field changes", () => {
    const skillMd =
      "---\nname: old\nallowed-tools:\n  - bash\n  - read\ndescription: >\n  folded\n  text\nlicense: MIT\n---\n\nBody";
    const next = withSkillField(skillMd, "name", "New name");
    expect(readSkillMd(next)).toEqual({
      description: "folded text",
      extra: ["allowed-tools:", "  - bash", "  - read", "license: MIT"],
      instructions: "Body",
      name: "New name",
    });
  });

  it("reads quoted values and a file without frontmatter", () => {
    expect(
      readSkillMd("---\nname: 'it''s'\ndescription: \"a: b\"\n---\nx")
    ).toMatchObject({ description: "a: b", instructions: "x", name: "it's" });
    expect(readSkillMd("Just instructions")).toEqual({
      description: "",
      extra: [],
      instructions: "Just instructions",
      name: "",
    });
  });

  it("quotes values YAML would misread", () => {
    expect(frontmatterValue("Code review")).toBe("Code review");
    expect(frontmatterValue("true")).toBe('"true"');
    expect(frontmatterValue("a: b")).toBe('"a: b"');
    expect(frontmatterValue("")).toBe("");
  });
});

describe("skillFieldIssues", () => {
  it("checks the name's format and both lengths", () => {
    expect(
      skillFieldIssues({
        description: "Does a thing.",
        instructions: "",
        name: "Code review",
      })
    ).toEqual({});
    expect(
      skillFieldIssues({ description: " ", instructions: "", name: "" })
    ).toEqual({ description: "required", name: "required" });
    expect(
      skillFieldIssues({
        description: "x".repeat(1025),
        instructions: "",
        name: "x".repeat(65),
      })
    ).toEqual({ description: "too_long", name: "too_long" });
    expect(
      skillFieldIssues({ description: "ok", instructions: "", name: "-a: b" })
    ).toEqual({ name: "invalid_format" });
  });
});

describe("skills in the builder form", () => {
  it("needs a name and description before a skill saves", () => {
    const definition = newDefinition("skill");
    expect(
      validateDraft({ definition, description: "", name: "x" })
    ).toMatchObject({
      "definition.skillMd.description": "required",
      "definition.skillMd.name": "required",
    });
  });

  it("takes the item's name and description from the frontmatter", () => {
    const skillMd = writeSkillMd({
      description: "When to use it.",
      instructions: "Do it.",
      name: "Data analysis",
    });
    const form = syncSkillItem({
      definition: { files: [], kind: "skill", skillMd },
      description: "",
      name: "",
    });
    expect(form.name).toBe("Data analysis");
    expect(form.description).toBe("When to use it.");
    expect(validateDraft(form)).toEqual({});
  });
});
