import type { LibraryItemId } from "@workspace/contract/schemas/common";
import { asSchema, type Tool } from "ai";
import { describe, expect, it, vi } from "vitest";

import { parseSkillMd } from "../../prompts/skills";
import { createSkillTool } from "./create-skill";
import { aiBuiltinTools } from "./index";
import { publishSkillTool } from "./publish-skill";
import {
  composeSkillMd,
  isSkillAuthoringTool,
  type SkillAuthoringOutput,
  type SkillAuthoringPorts,
  type SkillRef,
  skillAuthoringModelText,
  skillAuthoringOutputSchema,
} from "./skill-authoring";
import { createSkillAuthoringTools } from "./skill-tools";
import { updateSkillTool } from "./update-skill";

// The skill-authoring tools (128) over a fake port: they ask first, hand
// the call to the port unchanged (the server's library rules decide), and
// the model reads the outcome, or the refusal, as text.

const ID = "11111111-1111-4111-8111-111111111111" as LibraryItemId;

const skill: SkillRef = {
  description: "Writes release notes.",
  files: ["templates/notes.md"],
  library: { type: "personal" },
  name: "Release notes",
  skillId: ID,
  state: "draft",
  version: 1,
};

const call = (tool: Tool | undefined, input: unknown) =>
  tool?.execute?.(input, { context: {}, messages: [], toolCallId: "call_1" });

const fakePorts = (output: SkillAuthoringOutput) => {
  const ports = {
    create: vi.fn(() => Promise.resolve(output)),
    publish: vi.fn(() => Promise.resolve(output)),
    update: vi.fn(() => Promise.resolve(output)),
  } satisfies SkillAuthoringPorts;
  return { ports, tools: createSkillAuthoringTools(ports) };
};

describe("the skill tools' definitions", () => {
  it("all ask first, need the skills capability, and are registered", () => {
    for (const definition of [
      createSkillTool,
      updateSkillTool,
      publishSkillTool,
    ]) {
      expect(definition).toMatchObject({
        approval: "ask",
        capability: "skills",
        source: "builtin",
      });
      expect(aiBuiltinTools.get(definition.name)).toBe(definition);
      expect(isSkillAuthoringTool(definition.name)).toBe(true);
    }
    expect(isSkillAuthoringTool("load_skill")).toBe(false);
  });

  it("hands each call to its port as the model sent it, parsed", async () => {
    const saved: SkillAuthoringOutput = {
      skill,
      skillMd: "---\nname: x\n---\n\nBody\n",
      status: "saved",
    };
    const { ports, tools } = fakePorts(saved);
    const input = {
      description: "Writes release notes.",
      files: [{ content: "## Added\n", path: "templates/notes.md" }],
      instructions: "Group changes by area.",
      name: "Release notes",
    };
    expect(await call(tools.create_skill, input)).toEqual(saved);
    expect(ports.create).toHaveBeenCalledWith(input);

    await call(tools.update_skill, { instructions: "Shorter.", skillId: ID });
    expect(ports.update).toHaveBeenCalledWith({
      instructions: "Shorter.",
      skillId: ID,
    });

    const publish = {
      library: { name: "Eng", type: "team" },
      skillId: ID,
      skillName: "Release notes",
    };
    await call(tools.publish_skill, publish);
    expect(ports.publish).toHaveBeenCalledWith(publish);
  });

  it("describe their input to the model: paths stay inside the skill, and publish names where", () => {
    const create = asSchema(createSkillTool.input).jsonSchema as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(create.required.sort()).toEqual([
      "description",
      "instructions",
      "name",
    ]);
    const publish = asSchema(publishSkillTool.input).jsonSchema as {
      required: string[];
    };
    expect(publish.required.sort()).toEqual(["skillId", "skillName"]);
    expect(
      createSkillTool.input.safeParse({
        description: "d",
        files: [{ content: "x", path: "../outside.md" }],
        instructions: "i",
        name: "n",
      }).success
    ).toBe(false);
    expect(
      publishSkillTool.input.safeParse({
        library: { name: "Me", type: "user" },
        skillId: ID,
        skillName: "n",
      }).success
    ).toBe(false);
  });
});

describe("skillAuthoringModelText", () => {
  it("tells the model what happened and the id it needs next", () => {
    expect(
      skillAuthoringModelText({ skill, skillMd: "", status: "saved" })
    ).toBe(
      [
        `Saved the skill "Release notes" in the person's own library; it's a draft (it becomes version 1 when published).`,
        `skillId: ${ID}`,
        "Files: templates/notes.md",
        "People can pick it in chats once it's published (publish_skill).",
      ].join("\n")
    );
    expect(
      skillAuthoringModelText({
        skill: {
          ...skill,
          library: { id: "t1", name: "Eng", type: "team" },
          state: "published",
          version: 3,
        },
        status: "published",
        unchanged: false,
      })
    ).toContain(
      'Published "Release notes" as version 3 in the Eng team library.'
    );
    expect(
      skillAuthoringModelText({
        skill: { ...skill, state: "published" },
        status: "published",
        unchanged: true,
      })
    ).toContain("Nothing changed since version 1");
  });

  it("passes a refusal on as it is, so the model can act on it", () => {
    const refusal: SkillAuthoringOutput = {
      message: "The person can't change this skill.",
      status: "error",
    };
    expect(skillAuthoringModelText(refusal)).toBe(
      "The person can't change this skill."
    );
    // The chat's status line reads it as the call's error.
    expect(skillAuthoringOutputSchema.parse(refusal)).toEqual(refusal);
  });
});

describe("composeSkillMd", () => {
  it("writes the Agent Skills frontmatter, which parseSkillMd reads back", () => {
    const skillMd = composeSkillMd({
      description: "Use when: the PR is big\nor risky",
      instructions: "---\nname: stale\n---\n\n  Review it.  ",
      name: "PR review",
    });
    expect(skillMd).toBe(
      '---\nname: PR review\ndescription: "Use when: the PR is big or risky"\n---\n\nReview it.\n'
    );
    expect(parseSkillMd(skillMd)).toEqual({
      body: "Review it.",
      description: "Use when: the PR is big or risky",
      name: "PR review",
    });
  });
});
