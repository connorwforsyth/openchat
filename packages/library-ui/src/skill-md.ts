import type { IssueCode } from "./form";

// SKILL.md as form fields (170). The Agent Skills format is frontmatter
// (`name`, `description`) between `---` lines, then Markdown instructions.
// The skill form edits the three as fields and writes them back, keeping
// any other frontmatter (`license`, `allowed-tools`, …) as it was, so
// switching between the fields and the raw file loses nothing. Pure.

export interface SkillFields {
  readonly description: string;
  readonly instructions: string;
  readonly name: string;
}

export interface ParsedSkillMd extends SkillFields {
  /** Frontmatter lines that aren't `name` or `description`, verbatim. */
  readonly extra: readonly string[];
}

/** Agent Skills' caps on the two frontmatter fields. */
export const SKILL_NAME_MAX = 64;
export const SKILL_DESCRIPTION_MAX = 1024;
/** Shorter than this, a description rarely tells a model when to use the skill. */
export const SKILL_DESCRIPTION_HINT = 40;

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n?---[ \t]*(?:\r?\n|$)/;
const FIELD = /^([A-Za-z][\w-]*):[ \t]*(.*)$/;
const CONTINUATION = /^[ \t]+\S|^$/;
const LINE = /\r?\n/;
const LEADING_NEWLINE = /^\r?\n/;
const BLOCK = /^[>|][+-]?$/;
const PLAIN = /^[\p{L}\p{N}][\p{L}\p{N} _.,()/!?&'’-]*$/u;
const RESERVED = /^(?:true|false|null|yes|no|on|off|~)$/i;
const NAME_FORMAT = /^[\p{L}\p{N}][\p{L}\p{N} _.()&'’-]*$/u;

const unquote = (raw: string): string => {
  const value = raw.trim();
  if (value.startsWith('"') && value.endsWith('"') && value.length > 1) {
    try {
      return String(JSON.parse(value));
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.startsWith("'") && value.endsWith("'") && value.length > 1) {
    return value.slice(1, -1).replaceAll("''", "'");
  }
  return value;
};

/** A block scalar's lines (`>` folds them with spaces, `|` keeps them). */
const blockValue = (indicator: string, lines: readonly string[]): string => {
  const text = lines.map((line) => line.trim());
  return (indicator.startsWith(">") ? text.join(" ") : text.join("\n")).trim();
};

/** The fields of a `SKILL.md`; a file without frontmatter is all instructions. */
export const readSkillMd = (skillMd: string): ParsedSkillMd => {
  const match = FRONTMATTER.exec(skillMd);
  if (!match) {
    return { description: "", extra: [], instructions: skillMd, name: "" };
  }
  const lines = (match[1] ?? "").split(LINE);
  const extra: string[] = [];
  const found: Record<"description" | "name", string> = {
    description: "",
    name: "",
  };
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    const field = FIELD.exec(line);
    const key = field?.[1]?.toLowerCase();
    // A field's own lines: anything indented after it.
    let end = index + 1;
    while (end < lines.length && CONTINUATION.test(lines[end] ?? "")) {
      end += 1;
    }
    if (field && (key === "name" || key === "description")) {
      const value = field[2] ?? "";
      const more = lines.slice(index + 1, end).filter((each) => each !== "");
      found[key] = BLOCK.test(value.trim())
        ? blockValue(value.trim(), more)
        : [unquote(value), ...more.map((each) => each.trim())]
            .filter(Boolean)
            .join(" ");
    } else {
      extra.push(...lines.slice(index, end));
    }
    index = end;
  }
  return {
    ...found,
    extra: extra.filter((line, at) => line !== "" || at < extra.length - 1),
    instructions: skillMd.slice(match[0].length).replace(LEADING_NEWLINE, ""),
  };
};

/** A value on one frontmatter line, quoted when YAML would misread it. */
export const frontmatterValue = (value: string): string => {
  const line = value.replace(/\s*\r?\n\s*/g, " ");
  if (line === "") {
    return "";
  }
  return PLAIN.test(line) && !RESERVED.test(line) && line.trim() === line
    ? line
    : JSON.stringify(line);
};

const fieldLine = (key: string, value: string): string => {
  const written = frontmatterValue(value);
  return written ? `${key}: ${written}` : `${key}:`;
};

/** A `SKILL.md` from its fields, with any other frontmatter after them. */
export const writeSkillMd = ({
  description,
  extra = [],
  instructions,
  name,
}: SkillFields & { readonly extra?: readonly string[] }): string =>
  [
    "---",
    fieldLine("name", name),
    fieldLine("description", description),
    ...extra,
    "---",
    "",
    instructions,
  ].join("\n");

/** `skillMd` with one field changed and everything else as it was. */
export const withSkillField = (
  skillMd: string,
  field: keyof SkillFields,
  value: string
): string => writeSkillMd({ ...readSkillMd(skillMd), [field]: value });

export type SkillFieldIssues = Partial<
  Readonly<Record<"description" | "name", IssueCode>>
>;

/** What's wrong with the fields, as the form shows it while you type. */
export const skillFieldIssues = (fields: SkillFields): SkillFieldIssues => {
  const name = fields.name.trim();
  const description = fields.description.trim();
  const issues: { description?: IssueCode; name?: IssueCode } = {};
  if (name === "") {
    issues.name = "required";
  } else if (name.length > SKILL_NAME_MAX) {
    issues.name = "too_long";
  } else if (!NAME_FORMAT.test(name)) {
    issues.name = "invalid_format";
  }
  if (description === "") {
    issues.description = "required";
  } else if (description.length > SKILL_DESCRIPTION_MAX) {
    issues.description = "too_long";
  }
  return issues;
};
