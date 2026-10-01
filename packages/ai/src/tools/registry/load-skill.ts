import { z } from "zod";

import { LOAD_SKILL_TOOL, type LoadedSkill } from "../../prompts/skills";
import { defineTool, type ToolContext } from "./define";

// `load_skill` (127): an agent's skills are listed in its instructions by
// name and description, and it loads one on demand with this tool, which
// returns the skill's `SKILL.md` instructions and the files it bundles; with
// a `path`, it returns that file instead, read-only. It loads only what the
// turn was given (the skills attached to the agent's version, and those
// picked for the message), so naming any other skill is a `not_found` the
// model can read and recover from, never a lookup in the library.

/** The longest file the tool returns whole; the rest is cut, and says so. */
export const SKILL_FILE_MAX_CHARS = 100_000;

export const loadSkillInputSchema = z.object({
  path: z
    .string()
    .trim()
    .min(1)
    .max(512)
    .optional()
    .describe(
      "A file the skill bundles, by its path; leave out to get the skill's instructions and file list."
    ),
  skill: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .describe("The skill's name, as your instructions list it."),
});
export type LoadSkillInput = z.infer<typeof loadSkillInputSchema>;

export const loadSkillOutputSchema = z.discriminatedUnion("status", [
  z.object({
    files: z.array(z.string()),
    instructions: z.string(),
    name: z.string(),
    status: z.literal("loaded"),
  }),
  z.object({
    content: z.string(),
    name: z.string(),
    path: z.string(),
    status: z.literal("file"),
    /** Cut at `SKILL_FILE_MAX_CHARS`. */
    truncated: z.boolean(),
  }),
  z.object({ available: z.array(z.string()), status: z.literal("not_found") }),
  z.object({
    files: z.array(z.string()),
    name: z.string(),
    status: z.literal("no_such_file"),
  }),
  z.object({ message: z.string(), status: z.literal("unreadable") }),
]);
export type LoadSkillOutput = z.infer<typeof loadSkillOutputSchema>;

export interface SkillPorts {
  /** A bundled file's bytes; `null` when it can't be read right now. */
  readonly readFile: (
    skill: LoadedSkill,
    path: string
  ) => Promise<Uint8Array | null>;
  /** What this turn may load: the agent's skills and the message's picks. */
  readonly skills: readonly LoadedSkill[];
}

const LEADING_DOT_SLASH = /^(?:\.\/)+/;

/** The skill a call names: by id, else by name (ignoring case). */
const findSkill = (
  skills: readonly LoadedSkill[],
  named: string
): LoadedSkill | undefined => {
  const wanted = named.toLowerCase();
  return (
    skills.find((skill) => skill.id === named) ??
    skills.find((skill) => skill.name.toLowerCase() === wanted)
  );
};

const decode = (bytes: Uint8Array): string | null => {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
};

/** Applies a `load_skill` call against the skills the turn was given. */
export const loadSkill = async (
  ports: SkillPorts,
  input: LoadSkillInput
): Promise<LoadSkillOutput> => {
  const skill = findSkill(ports.skills, input.skill);
  if (!skill) {
    return {
      available: ports.skills.map((each) => each.name),
      status: "not_found",
    };
  }
  if (input.path === undefined) {
    return {
      files: [...skill.files],
      instructions: skill.instructions,
      name: skill.name,
      status: "loaded",
    };
  }
  const path = input.path.replace(LEADING_DOT_SLASH, "");
  if (!skill.files.includes(path)) {
    return {
      files: [...skill.files],
      name: skill.name,
      status: "no_such_file",
    };
  }
  const bytes = await ports.readFile(skill, path).catch(() => null);
  if (bytes === null) {
    return {
      message: `${path} couldn't be read right now.`,
      status: "unreadable",
    };
  }
  const text = decode(bytes);
  if (text === null) {
    return {
      message: `${path} isn't UTF-8 text, so it can't be shown.`,
      status: "unreadable",
    };
  }
  const truncated = text.length > SKILL_FILE_MAX_CHARS;
  return {
    content: truncated ? text.slice(0, SKILL_FILE_MAX_CHARS) : text,
    name: skill.name,
    path,
    status: "file",
    truncated,
  };
};

const list = (items: readonly string[]): string =>
  items.length === 0 ? "(none)" : items.map((item) => `- ${item}`).join("\n");

/** What the model reads: the instructions or the file as text, not JSON. */
export const loadSkillModelText = (output: LoadSkillOutput): string => {
  switch (output.status) {
    case "loaded":
      return `<skill name="${output.name}">\n${output.instructions}\n</skill>\n\nFiles it bundles:\n${list(output.files)}`;
    case "file":
      return `<skill-file skill="${output.name}" path="${output.path}">\n${output.content}\n</skill-file>${output.truncated ? `\n[Cut at ${SKILL_FILE_MAX_CHARS} characters.]` : ""}`;
    case "not_found":
      return `No such skill here. You can load:\n${list(output.available)}`;
    case "no_such_file":
      return `The skill "${output.name}" has no file at that path. Its files:\n${list(output.files)}`;
    case "unreadable":
      return output.message;
    default:
      return output satisfies never;
  }
};

export const loadSkillTool = defineTool({
  // It only reads what the turn was already given, so it never asks.
  approval: "auto",
  capability: "skills",
  description:
    "Load one of your skills: its instructions and the files it bundles. Pass a path as well to read one of those files.",
  execute: (input, { ports }: ToolContext<{ readonly ports: SkillPorts }>) =>
    loadSkill(ports, input),
  input: loadSkillInputSchema,
  modelText: loadSkillModelText,
  name: LOAD_SKILL_TOOL,
  output: loadSkillOutputSchema,
});
