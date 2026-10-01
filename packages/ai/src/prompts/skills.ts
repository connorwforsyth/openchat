import type {
  LibraryItemId,
  LibraryVersionId,
} from "@workspace/contract/schemas/common";

import type { PromptFile } from "./codegen";
import { FRAGMENTS } from "./generated";
import { fillPrompt } from "./template";

// Skills in a turn's instructions (127), from `fragments/skills.md`. A skill
// picked for the message goes in whole: its `SKILL.md` instructions in a
// `<skill>` block, as a section whose source names the version it came from,
// so a trace says which skill put a sentence in front of the model. An
// agent's own skills go in as a list of names and descriptions; it loads one
// with `load_skill` when the task calls for it. Pure.

/** The tool an agent loads its skills with, and reads a skill's files with. */
export const LOAD_SKILL_TOOL = "load_skill";

/** A skill's published version, as a turn reads it. */
export interface LoadedSkill {
  /** The frontmatter's `description`, else the library item's. */
  readonly description: string;
  /** Paths of the files it bundles, relative to the skill's root. */
  readonly files: readonly string[];
  readonly id: LibraryItemId;
  /** `SKILL.md` without its frontmatter. */
  readonly instructions: string;
  /** The library item's name. */
  readonly name: string;
  readonly versionId: LibraryVersionId;
}

export interface SkillFrontmatter {
  /** What's after the frontmatter, trimmed. */
  readonly body: string;
  readonly description?: string;
  readonly name?: string;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const FIELD = /^([A-Za-z][\w-]*):[ \t]*(.*)$/;
const QUOTED = /^(["'])(.*)\1$/;
const LINE = /\r?\n/;

const unquote = (value: string): string => {
  const trimmed = value.trim();
  return QUOTED.exec(trimmed)?.[2] ?? trimmed;
};

/**
 * `SKILL.md`'s frontmatter (the Agent Skills format: `name` and
 * `description` between `---` lines) and its body. Only one-line
 * `key: value` fields are read; anything else in the frontmatter is left
 * alone. A file without frontmatter is all body.
 */
export const parseSkillMd = (skillMd: string): SkillFrontmatter => {
  const match = FRONTMATTER.exec(skillMd);
  if (!match) {
    return { body: skillMd.trim() };
  }
  const fields = new Map<string, string>();
  for (const line of (match[1] ?? "").split(LINE)) {
    const field = FIELD.exec(line);
    if (field?.[1]) {
      fields.set(field[1].toLowerCase(), unquote(field[2] ?? ""));
    }
  }
  const name = fields.get("name");
  const description = fields.get("description");
  return {
    body: skillMd.slice(match[0].length).trim(),
    ...(description ? { description } : {}),
    ...(name ? { name } : {}),
  };
};

/** Where a picked skill's section came from: its item and version. */
export const skillSource = (
  skill: Pick<LoadedSkill, "id" | "versionId">
): string => `skill:${skill.id}@${skill.versionId}`;

const { parts } = FRAGMENTS.skills;

const fileList = (files: readonly string[]): string =>
  files.map((path) => `- ${path}`).join("\n");

/** A picked skill's section: its instructions, then the files it bundles. */
export const pickedSkillSection = (skill: LoadedSkill): PromptFile => {
  const picked = fillPrompt(parts.picked, {
    instructions: skill.instructions,
    name: skill.name,
  });
  const files =
    skill.files.length === 0
      ? []
      : [
          fillPrompt(parts.files, {
            files: fileList(skill.files),
            name: skill.name,
            tool: LOAD_SKILL_TOOL,
          }),
        ];
  return {
    source: skillSource(skill),
    text: [picked, ...files].join("\n\n"),
  };
};

/** The list an agent loads its own skills from; `undefined` without any. */
export const availableSkillsSection = (
  skills: readonly Pick<LoadedSkill, "description" | "name">[]
): PromptFile | undefined =>
  skills.length === 0
    ? undefined
    : {
        source: FRAGMENTS.skills.source,
        text: fillPrompt(parts.available, {
          skills: skills
            .map((skill) =>
              fillPrompt(parts.entry, {
                description: skill.description.trim() || skill.name,
                name: skill.name,
              })
            )
            .join("\n"),
          tool: LOAD_SKILL_TOOL,
        }),
      };

/**
 * A turn's skill sections: each picked skill whole, then the agent's own
 * (those not picked too) as a list to load from.
 */
export const skillSections = ({
  attached,
  picked,
}: {
  readonly attached: readonly LoadedSkill[];
  readonly picked: readonly LoadedSkill[];
}): readonly PromptFile[] => {
  const pickedIds = new Set(picked.map((skill) => skill.id));
  const available = availableSkillsSection(
    attached.filter((skill) => !pickedIds.has(skill.id))
  );
  return [...picked.map(pickedSkillSection), ...(available ? [available] : [])];
};
