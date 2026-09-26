import type { PromptDefinition } from "@workspace/contract/schemas/library";
import { err, ok, type Result } from "@workspace/shared/result";

// Prompt templates carry `{{variable}}` placeholders (D13). The definition
// declares variables with descriptions and defaults, but the template text is
// what gets filled, so the placeholders it actually contains are the truth:
// a declared variable the template never uses isn't asked for, and a
// placeholder nobody declared still is.

// Same name rule as the contract's `promptVariableSchema`; whitespace inside
// the braces is forgiven because people type `{{ topic }}`.
const PLACEHOLDER = /\{\{\s*([A-Za-z_][A-Za-z0-9_]{0,63})\s*\}\}/g;

export type PromptVariable = PromptDefinition["variables"][number];

export interface FillTemplateError {
  readonly code: "missing_variables";
  /** In template order. */
  readonly names: readonly string[];
}

/** Placeholder names in order of first appearance, without repeats. */
export const parseTemplateVariables = (template: string): readonly string[] => {
  const names: string[] = [];
  for (const match of template.matchAll(PLACEHOLDER)) {
    const [, name] = match;
    if (name !== undefined && !names.includes(name)) {
      names.push(name);
    }
  }
  return names;
};

/** The variables to ask for: every placeholder, with its declared description and default. */
export const resolvePromptVariables = (
  definition: Pick<PromptDefinition, "template" | "variables">
): readonly PromptVariable[] =>
  parseTemplateVariables(definition.template).map(
    (name) =>
      definition.variables.find((variable) => variable.name === name) ?? {
        name,
      }
  );

/** Starting values for a variables form: each default, or empty. */
export const initialVariableValues = (
  variables: readonly PromptVariable[]
): Readonly<Record<string, string>> =>
  Object.fromEntries(
    variables.map((variable) => [variable.name, variable.default ?? ""])
  );

const valueFor = (
  name: string,
  values: Readonly<Record<string, string>>,
  variables: readonly PromptVariable[]
): string | undefined => {
  const given = values[name];
  if (given !== undefined && given.trim() !== "") {
    return given;
  }
  return variables.find((variable) => variable.name === name)?.default;
};

/**
 * Replaces every placeholder with its value (or declared default). A blank
 * value with no default is an error listing every such name, so a form can
 * mark them all at once. Values are inserted literally: a `{{x}}` inside a
 * value is not expanded again.
 */
export const fillTemplate = (
  template: string,
  values: Readonly<Record<string, string>>,
  variables: readonly PromptVariable[] = []
): Result<string, FillTemplateError> => {
  const missing = parseTemplateVariables(template).filter(
    (name) => valueFor(name, values, variables) === undefined
  );
  if (missing.length > 0) {
    return err({ code: "missing_variables", names: missing });
  }
  return ok(
    template.replace(
      PLACEHOLDER,
      (_placeholder, name: string) => valueFor(name, values, variables) ?? ""
    )
  );
};
