import { describe, expect, it } from "vitest";

import {
  composeSkillMd,
  parseSkillMdParts,
  skillDescriptionIssue,
  skillNameIssue,
  slugifySkillName,
} from "./skill-md";

describe("parseSkillMdParts", () => {
  it("splits frontmatter fields from the body", () => {
    expect(
      parseSkillMdParts(
        "---\nname: pdf-tools\ndescription: Read PDFs\nlicense: MIT\n---\n\n# Use\nRun it."
      )
    ).toEqual({
      body: "# Use\nRun it.",
      description: "Read PDFs",
      extra: ["license: MIT"],
      name: "pdf-tools",
      structured: true,
    });
  });

  it("reads the new-skill template as empty fields", () => {
    expect(parseSkillMdParts("---\nname: \ndescription: \n---\n\n")).toEqual({
      body: "",
      description: "",
      extra: [],
      name: "",
      structured: true,
    });
  });

  it("unquotes quoted values", () => {
    const parts = parseSkillMdParts(
      `---\nname: 'a-b'\ndescription: "Use when: asked \\"why\\""\n---\nx`
    );
    expect(parts.name).toBe("a-b");
    expect(parts.description).toBe('Use when: asked "why"');
  });

  it("treats a file without frontmatter as all body", () => {
    expect(parseSkillMdParts("Just instructions")).toEqual({
      body: "Just instructions",
      description: "",
      extra: [],
      name: "",
      structured: true,
    });
  });

  it("isn't structured when a field is a multi-line block", () => {
    expect(
      parseSkillMdParts("---\nname: x\ndescription: >\n  folded\n---\nbody")
        .structured
    ).toBe(false);
  });
});

describe("composeSkillMd", () => {
  it("round-trips, keeping other frontmatter", () => {
    const md =
      "---\nname: pdf-tools\ndescription: Read PDFs\nlicense: MIT\n---\n\n# Use\nRun it.";
    expect(composeSkillMd(parseSkillMdParts(md))).toBe(md);
  });

  it("quotes values YAML would misread", () => {
    const md = composeSkillMd({
      body: "b",
      description: "Use when: asked",
      extra: [],
      name: "x",
    });
    expect(md).toBe('---\nname: x\ndescription: "Use when: asked"\n---\n\nb');
    expect(parseSkillMdParts(md).description).toBe("Use when: asked");
  });

  it("writes the empty template the builder starts from", () => {
    expect(
      composeSkillMd({ body: "", description: "", extra: [], name: "" })
    ).toBe("---\nname: \ndescription: \n---\n\n");
  });
});

describe("skill field rules (Agent Skills format)", () => {
  it("wants lowercase words joined by single hyphens, up to 64", () => {
    expect(skillNameIssue("")).toBeNull();
    expect(skillNameIssue("pdf-tools2")).toBeNull();
    expect(skillNameIssue("PDF tools")).toBe("invalid_format");
    expect(skillNameIssue("a--b")).toBe("invalid_format");
    expect(skillNameIssue("a".repeat(65))).toBe("too_long");
  });

  it("caps the description at 1024", () => {
    expect(skillDescriptionIssue("x".repeat(1024))).toBeNull();
    expect(skillDescriptionIssue("x".repeat(1025))).toBe("too_long");
  });

  it("slugifies a display name", () => {
    expect(slugifySkillName("  PDF Tools & More! ")).toBe("pdf-tools-more");
    expect(slugifySkillName("Été")).toBe("ete");
  });
});
