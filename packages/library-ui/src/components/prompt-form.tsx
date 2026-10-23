"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import {
  fillTemplate,
  initialVariableValues,
  type PromptVariable,
  resolvePromptVariables,
} from "@workspace/composer/variables";
import type { LibraryItemId } from "@workspace/contract/schemas/common";
import type { PromptDefinition } from "@workspace/contract/schemas/library";
import {
  FieldDescription,
  FieldGroup,
  FieldLegend,
  FieldSet,
} from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import { type ChangeEvent, useCallback, useState } from "react";

import type { FormIssues } from "../form";
import {
  NEW_VARIABLE_NAME,
  type SnippetItem,
  snippetMenuItems,
} from "../snippet";
import type { Choice } from "./agent-form";
import { issueAt, SnippetField, TextField } from "./fields";
import type { SnippetMenu } from "./snippet-editor";

// The Prompt builder (D13): a template with `{{variables}}`, an optional
// `/command`, and per-variable descriptions and defaults. The variables are
// whatever placeholders the template holds (the composer's rule), so typing
// `{{topic}}` adds one and deleting it drops it.

export interface PromptFormProps {
  readonly issues: FormIssues;
  readonly onChange: (next: PromptDefinition) => void;
  /** Another prompt's template, for the `/` menu; `null` when it can't be read. */
  readonly onLoadPrompt?: (id: LibraryItemId) => Promise<string | null>;
  /** Other prompts, for the `/` menu. */
  readonly prompts?: readonly Choice[];
  readonly readOnly?: boolean;
  readonly value: PromptDefinition;
}

const NO_PROMPTS: readonly Choice[] = [];

type VariablePatch = Partial<Pick<PromptVariable, "default" | "description">>;

export function PromptForm({
  issues,
  onChange,
  onLoadPrompt,
  prompts = NO_PROMPTS,
  readOnly = false,
  value,
}: PromptFormProps) {
  const { t } = useLingui();
  // Braces are ICU syntax, so the example goes in as a value.
  const example = "{{name}}";
  const variables = resolvePromptVariables(value);

  const setTemplate = useCallback(
    (template: string) => onChange({ ...value, template }),
    [onChange, value]
  );
  const menu: SnippetMenu = {
    items: (query) =>
      snippetMenuItems(query, {
        newVariable: true,
        prompts: onLoadPrompt
          ? prompts.map((prompt) => ({
              id: prompt.id,
              kind: "prompt",
              name: prompt.name,
            }))
          : undefined,
        variables: variables.map((variable) => ({
          description: variable.description,
          kind: "variable",
          name: variable.name,
        })),
      }),
    onPick: (item: SnippetItem) => {
      switch (item.kind) {
        case "new-variable":
          return `{{${NEW_VARIABLE_NAME}}}`;
        case "variable":
          return `{{${item.name}}}`;
        case "prompt":
          return onLoadPrompt?.(item.id) ?? null;
        case "skill":
          return null;
        default:
          return item satisfies never;
      }
    },
    title: t`Insert`,
  };
  const setCommand = useCallback(
    (command: string) =>
      onChange({ ...value, command: command === "" ? undefined : command }),
    [onChange, value]
  );
  const setVariable = useCallback(
    (name: string, patch: VariablePatch) => {
      const current = value.variables.find((each) => each.name === name) ?? {
        name,
      };
      const next = { ...current, ...patch };
      onChange({
        ...value,
        variables: [
          ...value.variables.filter((each) => each.name !== name),
          {
            name,
            ...(next.description ? { description: next.description } : {}),
            ...(next.default ? { default: next.default } : {}),
          },
        ],
      });
    },
    [onChange, value]
  );

  return (
    <FieldGroup>
      <SnippetField
        className="min-h-40 font-mono text-sm"
        description={t`Use ${example} for a value people fill in when they use the prompt. Type / to insert a variable or another prompt.`}
        issue={issueAt(issues, "definition.template")}
        label={t`Template`}
        menu={readOnly ? undefined : menu}
        onValueChange={setTemplate}
        readOnly={readOnly}
        value={value.template}
      />
      <TextField
        description={t`Lowercase letters, digits and dashes. Type / and this in the composer to use it.`}
        issue={issueAt(issues, "definition.command")}
        label={t`Slash command`}
        name="command"
        onValueChange={setCommand}
        placeholder={t`explain`}
        readOnly={readOnly}
        value={value.command ?? ""}
      />
      {variables.length > 0 ? (
        <FieldSet>
          <FieldLegend variant="label">
            <Trans>Variables</Trans>
          </FieldLegend>
          {variables.map((variable) => (
            <VariableRow
              key={variable.name}
              onChange={setVariable}
              readOnly={readOnly}
              variable={variable}
            />
          ))}
        </FieldSet>
      ) : null}
    </FieldGroup>
  );
}

function VariableRow({
  onChange,
  readOnly,
  variable,
}: {
  readonly onChange: (name: string, patch: VariablePatch) => void;
  readonly readOnly: boolean;
  readonly variable: PromptVariable;
}) {
  const { t } = useLingui();
  const { name } = variable;
  const setDescription = useCallback(
    (event: ChangeEvent<HTMLInputElement>) =>
      onChange(name, { description: event.currentTarget.value }),
    [name, onChange]
  );
  const setDefault = useCallback(
    (event: ChangeEvent<HTMLInputElement>) =>
      onChange(name, { default: event.currentTarget.value }),
    [name, onChange]
  );
  return (
    <div className="grid gap-2 sm:grid-cols-[8rem_1fr_1fr]">
      <code className="self-center truncate font-mono text-sm">
        {`{{${name}}}`}
      </code>
      <Input
        aria-label={t`Description for ${name}`}
        onChange={setDescription}
        placeholder={t`Description`}
        readOnly={readOnly}
        value={variable.description ?? ""}
      />
      <Input
        aria-label={t`Default for ${name}`}
        onChange={setDefault}
        placeholder={t`Default`}
        readOnly={readOnly}
        value={variable.default ?? ""}
      />
    </div>
  );
}

/** The template filled in with sample values: what someone using it would send. */
export function PromptPreview({ value }: { readonly value: PromptDefinition }) {
  const { t } = useLingui();
  const variables = resolvePromptVariables(value);
  const [values, setValues] = useState<Readonly<Record<string, string>>>(() =>
    initialVariableValues(variables)
  );
  const filled = fillTemplate(value.template, values, variables);
  const setValue = useCallback(
    (next: string, name: string) =>
      setValues((current) => ({ ...current, [name]: next })),
    []
  );

  return (
    <section aria-label={t`Preview`} className="flex flex-col gap-4">
      <h2 className="font-medium text-sm">
        <Trans>Preview</Trans>
      </h2>
      {variables.length > 0 ? (
        <FieldGroup>
          {variables.map((variable) => (
            <TextField
              description={variable.description}
              key={variable.name}
              label={variable.name}
              name={variable.name}
              onValueChange={setValue}
              value={values[variable.name] ?? variable.default ?? ""}
            />
          ))}
        </FieldGroup>
      ) : null}
      <div className="whitespace-pre-wrap rounded-lg border border-border bg-muted p-3 text-sm">
        {filled.ok ? (
          filled.value
        ) : (
          <FieldDescription>
            <Trans>Fill in every variable to see the message.</Trans>
          </FieldDescription>
        )}
      </div>
    </section>
  );
}
