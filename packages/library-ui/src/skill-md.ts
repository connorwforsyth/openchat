import { z } from "zod";

import type { IssueCode } from "./form";

// `SKILL.md` as the skill editor shows it (D13): the frontmatter's `name` and
// `description` as fields, the rest as the instructions. Pure, so the editor
// can switch between fields and the raw file without losing anything:
// frontmatter it doesn't know is kept, line for line.

export const skillMdPartsSchema = z.object({
  body: z.string(),
  description: z.string(),
  /** Other frontmatter lines, verbatim (`license: MIT`, `metadata:` …). */
  extra: z.array(z.string()).readonly(),
  name: z.string(),
});
export type SkillMdParts = z.infer<typeof skillMdPartsSchema>;

export const parsedSkillMdSchema = skillMdPartsSchema.extend({
  /** False when the fields can't be edited safely (multi-line YAML); edit the raw file. */
  structured: z.boolean(),
});
export type ParsedSkillMd = z.infer<typeof parsedSkillMdSchema>;

/** The Agent Skills spec's limits. */
export const SKILL_NAME_MAX = 64;
export const SKILL_DESCRIPTION_MAX = 1024;

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n?---[ \t]*(?:\r?\n|$)/;
const FIELD = /^(name|description):[ \t]*(.*)$/;
const BLOCK_SCALAR = /^[|>][+-]?\d*$/;
const NAME_FORMAT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LINE_BREAK = /\r?\n/;
const COMBINING_MARKS = /\p{M}/gu;
const NOT_SLUG = /[^a-z0-9]+/g;
const EDGE_HYPHENS = /^-+|-+$/g;
const TRAILING_HYPHENS = /-+$/;
const INDENTED = /^[ \t]/;
const LEADING_BLANK = /^\r?\n/;
const NEEDS_QUOTES = /(?:^[\s'"`[\]{}>|*&!%@#,?-])|(?::\s)|(?:\s#)|(?:\s$)/;

const unquote = (raw: string): string => {
  const value = raw.trim();
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value) as string;
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replaceAll("''", "'");
  }
  return value;
};

const quote = (value: string): string =>
  value !== "" && NEEDS_QUOTES.test(value) ? JSON.stringify(value) : value;

/** `SKILL.md` as fields; a file without frontmatter is all body. */
export const parseSkillMdParts = (skillMd: string): ParsedSkillMd => {
  const match = FRONTMATTER.exec(skillMd);
  if (!match) {
    return {
      body: skillMd,
      description: "",
      extra: [],
      name: "",
      structured: true,
    };
  }
  const fields = { description: "", name: "" };
  const extra: string[] = [];
  let structured = true;
  let inField = false;
  for (const line of (match[1] ?? "").split(LINE_BREAK)) {
    const field = FIELD.exec(line);
    if (field) {
      const [, key, value = ""] = field;
      if (BLOCK_SCALAR.test(value.trim())) {
        structured = false;
      }
      fields[key as "name" | "description"] = unquote(value);
      inField = true;
    } else if (inField && INDENTED.test(line)) {
      // A field continued over several lines: only the raw file can say it.
      structured = false;
    } else if (line !== "") {
      extra.push(line);
      inField = false;
    }
  }
  return {
    body: skillMd.slice(match[0].length).replace(LEADING_BLANK, ""),
    ...fields,
    extra,
    structured,
  };
};

/** Fields back into `SKILL.md`, frontmatter first. */
export const composeSkillMd = (parts: SkillMdParts): string =>
  [
    "---",
    `name: ${quote(parts.name)}`,
    `description: ${quote(parts.description)}`,
    ...parts.extra,
    "---",
    "",
    parts.body,
  ].join("\n");

/** Lowercase letters and digits, single hyphens between words, up to 64. Empty is allowed. */
export const skillNameIssue = (name: string): IssueCode | null => {
  if (name === "") {
    return null;
  }
  if (name.length > SKILL_NAME_MAX) {
    return "too_long";
  }
  return NAME_FORMAT.test(name) ? null : "invalid_format";
};

export const skillDescriptionIssue = (description: string): IssueCode | null =>
  description.length > SKILL_DESCRIPTION_MAX ? "too_long" : null;

/** A display name as a skill name: `PDF Tools` → `pdf-tools`. */
export const slugifySkillName = (text: string): string =>
  text
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(NOT_SLUG, "-")
    .replace(EDGE_HYPHENS, "")
    .slice(0, SKILL_NAME_MAX)
    .replace(TRAILING_HYPHENS, "");
