"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import {
  type ChangeEvent,
  type KeyboardEvent,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import type { PromptOption } from "../schemas";
import {
  fillTemplate,
  initialVariableValues,
  type PromptVariable,
} from "../variables";

export interface TemplateVariablesProps {
  readonly onCancel: () => void;
  /** Called with the filled template once every variable has a value. */
  readonly onInsert: (text: string) => void;
  readonly prompt: PromptOption;
  readonly variables: readonly PromptVariable[];
}

interface VariableFieldProps {
  readonly id: string;
  readonly inputRef: RefObject<HTMLInputElement | null> | undefined;
  readonly invalid: boolean;
  readonly onChange: (name: string, value: string) => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  readonly value: string;
  readonly variable: PromptVariable;
}

function VariableField({
  id,
  inputRef,
  invalid,
  onChange,
  onKeyDown,
  value,
  variable,
}: VariableFieldProps) {
  const descriptionId = `${id}-description`;
  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) =>
      onChange(variable.name, event.currentTarget.value),
    [onChange, variable.name]
  );
  return (
    <div className="flex flex-col gap-1">
      <label className="font-mono text-xs" htmlFor={id}>
        {variable.name}
      </label>
      <Input
        aria-describedby={variable.description ? descriptionId : undefined}
        aria-invalid={invalid || undefined}
        id={id}
        onChange={handleChange}
        onKeyDown={onKeyDown}
        placeholder={variable.default}
        ref={inputRef}
        value={value}
      />
      {variable.description ? (
        <p className="text-muted-foreground text-xs" id={descriptionId}>
          {variable.description}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Asks for a template's `{{variables}}` before it goes into the message.
 * It sits inside the composer's form, so Enter is handled here rather than
 * left to submit the message.
 */
export function TemplateVariables({
  onCancel,
  onInsert,
  prompt,
  variables,
}: TemplateVariablesProps) {
  const { t } = useLingui();
  const baseId = useId();
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const [values, setValues] = useState(() => initialVariableValues(variables));
  const [missing, setMissing] = useState<readonly string[]>([]);

  // Choosing the template moved the user here; put them in the first field.
  useEffect(() => {
    firstFieldRef.current?.focus();
  }, []);

  const setValue = useCallback((name: string, value: string) => {
    setValues((current) => ({ ...current, [name]: value }));
  }, []);

  const insert = useCallback(() => {
    const filled = fillTemplate(prompt.definition.template, values, variables);
    if (filled.ok) {
      onInsert(filled.value);
      return;
    }
    setMissing(filled.error.names);
    document
      .getElementById(`${baseId}-${filled.error.names[0] ?? ""}`)
      ?.focus();
  }, [baseId, onInsert, prompt.definition.template, values, variables]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter" && !event.nativeEvent.isComposing) {
        event.preventDefault();
        insert();
      } else if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    },
    [insert, onCancel]
  );

  const promptName = prompt.name;

  return (
    <fieldset
      className="order-first flex w-full min-w-0 flex-col gap-3 border-border border-b p-3"
      data-slot="composer-template-variables"
    >
      <legend className="float-start mb-1 w-full font-medium text-sm">
        <Trans>Fill in “{promptName}”</Trans>
      </legend>
      {variables.map((variable, index) => (
        <VariableField
          id={`${baseId}-${variable.name}`}
          inputRef={index === 0 ? firstFieldRef : undefined}
          invalid={missing.includes(variable.name)}
          key={variable.name}
          onChange={setValue}
          onKeyDown={handleKeyDown}
          value={values[variable.name] ?? ""}
          variable={variable}
        />
      ))}
      {missing.length > 0 ? (
        <p className="text-destructive text-xs" role="alert">
          <Trans>Fill in every field to insert the prompt.</Trans>
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button onClick={onCancel} size="sm" type="button" variant="ghost">
          <Trans>Cancel</Trans>
        </Button>
        <Button
          aria-label={t`Insert prompt`}
          onClick={insert}
          size="sm"
          type="button"
        >
          <Trans>Insert</Trans>
        </Button>
      </div>
    </fieldset>
  );
}
