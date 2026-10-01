import {
  libraryItemIdSchema,
  orgIdSchema,
  teamIdSchema,
} from "@workspace/contract/schemas/common";
import { skillFileSchema } from "@workspace/contract/schemas/library";
import { z } from "zod";

import { parseSkillMd } from "../../prompts/skills";

// What `create_skill`, `update_skill` and `publish_skill` share (128): the
// schemas the model writes and reads, the port the server binds them to, and
// the pure helpers. The tools only shape calls; who may do what is the
// library's rule (`packages/server/src/library`), applied by the port, and a
// refusal comes back as an `error` result the model reads and can act on,
// never a thrown error (which would fail the run, 131).
//
// No `defineTool` here, so the chat UI can read results with these schemas
// without pulling in the tools.

export const CREATE_SKILL_TOOL = "create_skill";
export const UPDATE_SKILL_TOOL = "update_skill";
export const PUBLISH_SKILL_TOOL = "publish_skill";
export const SKILL_AUTHORING_TOOLS = [
  CREATE_SKILL_TOOL,
  UPDATE_SKILL_TOOL,
  PUBLISH_SKILL_TOOL,
] as const;
export type SkillAuthoringTool = (typeof SKILL_AUTHORING_TOOLS)[number];

export const isSkillAuthoringTool = (
  name: string
): name is SkillAuthoringTool =>
  (SKILL_AUTHORING_TOOLS as readonly string[]).includes(name);

/** Most files one call may write; a skill's files are small resources, not a repo. */
export const SKILL_TOOL_MAX_FILES = 20;
/** Longest file one call may write, in characters. */
export const SKILL_TOOL_FILE_MAX_CHARS = 100_000;
/** Longest instructions, leaving room for the frontmatter in `SKILL.md`'s 200k. */
export const SKILL_INSTRUCTIONS_MAX_CHARS = 190_000;

const nameSchema = z.string().trim().min(1).max(200);
const descriptionSchema = z.string().trim().min(1).max(1000);

export const skillTextFileSchema = z.object({
  content: z
    .string()
    .max(SKILL_TOOL_FILE_MAX_CHARS)
    .describe("The file's whole text."),
  path: skillFileSchema.shape.path.describe(
    "Where it sits beside SKILL.md, e.g. templates/notes.md. Relative; no `..`."
  ),
});
export type SkillTextFile = z.infer<typeof skillTextFileSchema>;

const filesSchema = z.array(skillTextFileSchema).max(SKILL_TOOL_MAX_FILES);

const instructionsSchema = z
  .string()
  .trim()
  .min(1)
  .max(SKILL_INSTRUCTIONS_MAX_CHARS);

export const createSkillInputSchema = z.object({
  description: descriptionSchema.describe(
    "One or two sentences: what the skill does and when to use it. Shown in the library and to models choosing a skill."
  ),
  files: filesSchema
    .optional()
    .describe(
      "Small text files the skill bundles (templates, examples, reference notes). Leave out when it needs none."
    ),
  instructions: instructionsSchema.describe(
    "The body of SKILL.md, in Markdown: the instructions a model follows when it uses the skill. No frontmatter; the name and description are added."
  ),
  name: nameSchema.describe("A short name people will pick it by."),
});
export type CreateSkillInput = z.infer<typeof createSkillInputSchema>;

export const updateSkillInputSchema = z.object({
  description: descriptionSchema.optional().describe("A new description."),
  files: filesSchema
    .optional()
    .describe(
      "Files to add or replace, by path; the skill's other files are kept."
    ),
  instructions: instructionsSchema
    .optional()
    .describe(
      "The whole new body of SKILL.md (not a diff); leave out to keep it."
    ),
  name: nameSchema.optional().describe("A new name."),
  removeFiles: z
    .array(skillFileSchema.shape.path)
    .max(SKILL_TOOL_MAX_FILES)
    .optional()
    .describe("Paths of bundled files to remove."),
  skillId: libraryItemIdSchema.describe(
    "The skillId create_skill (or an earlier update_skill) returned."
  ),
});
export type UpdateSkillInput = z.infer<typeof updateSkillInputSchema>;

/** A team or org library, by name as the person knows it; the id settles two of one name. */
export const skillLibraryInputSchema = z.discriminatedUnion("type", [
  z.object({
    id: teamIdSchema.optional(),
    name: nameSchema,
    type: z.literal("team"),
  }),
  z.object({
    id: orgIdSchema.optional(),
    name: nameSchema,
    type: z.literal("org"),
  }),
]);
export type SkillLibraryInput = z.infer<typeof skillLibraryInputSchema>;

export const publishSkillInputSchema = z.object({
  library: skillLibraryInputSchema
    .optional()
    .describe(
      "The team or org library to publish it to. Leave out to publish it in the person's own library. The person sees this before they approve."
    ),
  notes: z
    .string()
    .trim()
    .max(4000)
    .optional()
    .describe("What changed in this version, for the version history."),
  skillId: libraryItemIdSchema.describe("The skill to publish."),
  skillName: nameSchema.describe(
    "The skill's current name, exactly. The person sees it before they approve, and the call is refused if it doesn't match."
  ),
});
export type PublishSkillInput = z.infer<typeof publishSkillInputSchema>;

/** Which library a skill is in: the person's own, someone else's, a team's or an org's. */
export const skillLibrarySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("personal") }),
  z.object({ id: z.string(), name: z.string(), type: z.literal("user") }),
  z.object({ id: z.string(), name: z.string(), type: z.literal("team") }),
  z.object({ id: z.string(), name: z.string(), type: z.literal("org") }),
]);
export type SkillLibrary = z.infer<typeof skillLibrarySchema>;

/** A skill as a result names it, for the model and for the chat's card. */
export const skillRefSchema = z.object({
  description: z.string(),
  files: z.array(z.string()),
  library: skillLibrarySchema,
  name: z.string(),
  skillId: libraryItemIdSchema,
  /** `draft`: saved, not yet what people get; `published`: `version` is live. */
  state: z.enum(["draft", "published"]),
  /** The published version's number, or the number the draft will get. */
  version: z.int().min(1),
});
export type SkillRef = z.infer<typeof skillRefSchema>;

export const skillAuthoringOutputSchema = z.discriminatedUnion("status", [
  z.object({
    /** The draft's `SKILL.md` before this call; absent for a new skill. */
    previousSkillMd: z.string().optional(),
    skill: skillRefSchema,
    skillMd: z.string(),
    status: z.literal("saved"),
  }),
  z.object({
    skill: skillRefSchema,
    status: z.literal("published"),
    /** Nothing had changed since the last version, so none was added. */
    unchanged: z.boolean(),
  }),
  /** Refused or failed; the message says why and what to do instead. */
  z.object({ message: z.string(), status: z.literal("error") }),
]);
export type SkillAuthoringOutput = z.infer<typeof skillAuthoringOutputSchema>;

/**
 * What the tools need from the server: the library's own create, edit and
 * publish, as the person, with its permission checks. Each returns a
 * result, refusals included; none throws for an expected failure.
 */
export interface SkillAuthoringPorts {
  readonly create: (input: CreateSkillInput) => Promise<SkillAuthoringOutput>;
  readonly publish: (input: PublishSkillInput) => Promise<SkillAuthoringOutput>;
  readonly update: (input: UpdateSkillInput) => Promise<SkillAuthoringOutput>;
}

const LINE_BREAKS = /\s*[\r\n]+\s*/g;
/** What YAML reads as plain text: no `:`, `#`, quotes at the start, or flow markers. */
const PLAIN_SCALAR = /^[\w ,.()'/-]*$/;

/** A frontmatter value on one line, quoted when YAML would read it as something else. */
const frontmatterValue = (value: string): string => {
  const line = value.replace(LINE_BREAKS, " ").trim();
  return PLAIN_SCALAR.test(line) && !line.startsWith("'")
    ? line
    : JSON.stringify(line);
};

/**
 * `SKILL.md` in the Agent Skills format: `name` and `description` in the
 * frontmatter, then the instructions. Instructions that already start with
 * frontmatter lose it, so the name and description given win. Pure.
 */
export const composeSkillMd = ({
  description,
  instructions,
  name,
}: {
  readonly description: string;
  readonly instructions: string;
  readonly name: string;
}): string =>
  `---\nname: ${frontmatterValue(name)}\ndescription: ${frontmatterValue(description)}\n---\n\n${parseSkillMd(instructions).body}\n`;

/** Where a skill is, in words the model reads. Pure. */
export const skillLibraryText = (library: SkillLibrary): string => {
  switch (library.type) {
    case "personal":
      return "the person's own library";
    case "user":
      return `${library.name}'s library`;
    default:
      return `the ${library.name} ${library.type} library`;
  }
};

const stateText = (skill: SkillRef): string =>
  skill.state === "draft"
    ? `a draft (it becomes version ${skill.version} when published)`
    : `published as version ${skill.version}`;

/** What the model reads: the outcome and the ids it needs next, not JSON. */
export const skillAuthoringModelText = (
  output: SkillAuthoringOutput
): string => {
  switch (output.status) {
    case "saved":
      return [
        `Saved the skill "${output.skill.name}" in ${skillLibraryText(output.skill.library)}; it's ${stateText(output.skill)}.`,
        `skillId: ${output.skill.skillId}`,
        output.skill.files.length > 0
          ? `Files: ${output.skill.files.join(", ")}`
          : "Files: (none)",
        "People can pick it in chats once it's published (publish_skill).",
      ].join("\n");
    case "published":
      return [
        output.unchanged
          ? `Nothing changed since version ${output.skill.version} of "${output.skill.name}", so no new version was made; it's published in ${skillLibraryText(output.skill.library)}.`
          : `Published "${output.skill.name}" as version ${output.skill.version} in ${skillLibraryText(output.skill.library)}. People with access can pick it in chats now.`,
        `skillId: ${output.skill.skillId}`,
      ].join("\n");
    case "error":
      return output.message;
    default:
      return output satisfies never;
  }
};
