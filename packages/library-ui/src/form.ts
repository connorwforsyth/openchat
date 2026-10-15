import {
  descriptionSchema,
  nameSchema,
} from "@workspace/contract/schemas/common";
import {
  type AgentDefinition,
  type LibraryDefinition,
  type LibraryDefinitionInput,
  type LibraryKind,
  libraryDefinitionInputSchema,
} from "@workspace/contract/schemas/library";
import type { ModelSelector } from "@workspace/contract/schemas/models";

import { readSkillMd, skillFieldIssues, writeSkillMd } from "./skill-md";

// The builder's form state and its validation, as pure functions. The
// contract's own schemas decide what's valid (zod first, D8), so the form
// can't drift from what the server accepts; the UI only turns issue codes
// into words.

export interface DraftForm {
  readonly definition: LibraryDefinitionInput;
  readonly description: string;
  readonly name: string;
}

/** Why a field is invalid, for the UI to word. */
export type IssueCode =
  | "required"
  | "too_long"
  | "too_many"
  | "invalid_format"
  | "invalid";

/** Field path (`name`, `definition.template`, `definition.conversationStarters.2`) to its first issue. */
export type FormIssues = Readonly<Record<string, IssueCode>>;

const codeOf = (issue: {
  readonly code: string;
  readonly minimum?: unknown;
  readonly origin?: unknown;
}): IssueCode => {
  switch (issue.code) {
    case "too_small":
      return "required";
    case "too_big":
      return issue.origin === "array" ? "too_many" : "too_long";
    case "invalid_format":
      return "invalid_format";
    default:
      return "invalid";
  }
};

const keyOf = (path: readonly PropertyKey[]): string =>
  path.map((part) => String(part)).join(".");

/** Every field that breaks the contract, first issue each. Empty means savable. */
export const validateDraft = (form: DraftForm): FormIssues => {
  const issues: Record<string, IssueCode> = {};
  const name = nameSchema.safeParse(form.name);
  if (!name.success) {
    issues.name = codeOf(name.error.issues[0] ?? { code: "invalid" });
  }
  const description = descriptionSchema.safeParse(form.description);
  if (!description.success) {
    issues.description = "too_long";
  }
  const definition = libraryDefinitionInputSchema.safeParse(form.definition);
  if (!definition.success) {
    for (const issue of definition.error.issues) {
      const key = keyOf(["definition", ...issue.path]);
      issues[key] ??= codeOf(issue);
    }
  }
  // A skill's name and description live in SKILL.md's frontmatter (170),
  // and a model picks the skill by them, so both are needed to save.
  if (form.definition.kind === "skill") {
    const skill = skillFieldIssues(readSkillMd(form.definition.skillMd));
    if (skill.name) {
      issues["definition.skillMd.name"] = skill.name;
    }
    if (skill.description) {
      issues["definition.skillMd.description"] = skill.description;
    }
  }
  return issues;
};

/** A stored definition as form state: write-only secrets start empty. */
export const formFromDefinition = (
  definition: LibraryDefinition
): LibraryDefinitionInput => {
  if (definition.kind === "mcp_server" && definition.auth.type === "header") {
    return {
      ...definition,
      auth: { headerName: definition.auth.headerName, type: "header" },
    };
  }
  return definition as LibraryDefinitionInput;
};

/** The definition to send: only what the server takes (a header secret only when typed). */
export const definitionToSave = (
  definition: LibraryDefinitionInput
): LibraryDefinitionInput => {
  if (
    definition.kind === "mcp_server" &&
    definition.auth.type === "header" &&
    !definition.auth.value
  ) {
    return {
      ...definition,
      auth: { headerName: definition.auth.headerName, type: "header" },
    };
  }
  return definition;
};

const emptyAgent = (model: ModelSelector): AgentDefinition => ({
  approvals: { default: "auto", tools: {} },
  conversationStarters: [],
  instructions: "",
  kind: "agent",
  knowledgeFileIds: [],
  mcpServers: [],
  model,
  parameters: {},
  sandboxProvider: null,
  skills: [],
  tools: [],
});

/** A fresh definition for a new item of `kind`. */
export const newDefinition = (
  kind: LibraryKind,
  model: ModelSelector = "auto"
): LibraryDefinitionInput => {
  switch (kind) {
    case "agent":
      return emptyAgent(model);
    case "prompt":
      return { kind: "prompt", template: "", variables: [] };
    case "skill":
      return {
        files: [],
        kind: "skill",
        skillMd: writeSkillMd({ description: "", instructions: "", name: "" }),
      };
    case "mcp_server":
      return {
        auth: { type: "none" },
        kind: "mcp_server",
        transport: "http",
        url: "",
      };
    case "preset":
      return { kind: "preset", model, parameters: {} };
    default:
      return kind satisfies never;
  }
};

/**
 * A skill's library name and description follow its frontmatter (170): the
 * form edits them there, and the library lists the item by them.
 */
export const syncSkillItem = (form: DraftForm): DraftForm => {
  if (form.definition.kind !== "skill") {
    return form;
  }
  const { description, name } = readSkillMd(form.definition.skillMd);
  return {
    ...form,
    description: description.trim().slice(0, 2000),
    name: name.trim().slice(0, 200),
  };
};

/** Whether two forms would save the same thing. */
export const sameForm = (a: DraftForm, b: DraftForm): boolean =>
  JSON.stringify(a) === JSON.stringify(b);
