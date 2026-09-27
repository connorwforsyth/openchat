"use client";

import { useLingui } from "@lingui/react/macro";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import { Textarea } from "@workspace/ui/components/textarea";
import {
  type ChangeEvent,
  type ComponentProps,
  type ReactNode,
  useCallback,
  useId,
} from "react";

import type { FormIssues, IssueCode } from "../form";

// Labelled inputs for the builders, with the contract's validation shown
// the shadcn way (`data-invalid` on the field, `aria-invalid` on the control).

export const useIssueText = (): ((code: IssueCode) => string) => {
  const { t } = useLingui();
  return (code) => {
    switch (code) {
      case "required":
        return t`Required.`;
      case "too_long":
        return t`That's too long.`;
      case "too_many":
        return t`That's too many.`;
      case "invalid_format":
        return t`That doesn't look right.`;
      case "invalid":
        return t`That isn't valid.`;
      default:
        return code satisfies never;
    }
  };
};

interface FieldShellProps {
  readonly children: (props: {
    readonly "aria-describedby"?: string;
    readonly "aria-invalid"?: boolean;
    readonly id: string;
  }) => ReactNode;
  readonly description?: ReactNode;
  readonly issue?: IssueCode;
  readonly label: ReactNode;
}

export function FieldShell({
  children,
  description,
  issue,
  label,
}: FieldShellProps) {
  const id = useId();
  const describedBy = `${id}-description`;
  const issueText = useIssueText();
  return (
    <Field data-invalid={issue ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {children({
        "aria-describedby": description || issue ? describedBy : undefined,
        "aria-invalid": issue ? true : undefined,
        id,
      })}
      {issue ? (
        <FieldError id={describedBy}>{issueText(issue)}</FieldError>
      ) : null}
      {description && !issue ? (
        <FieldDescription id={describedBy}>{description}</FieldDescription>
      ) : null}
    </Field>
  );
}

export function TextField({
  description,
  issue,
  label,
  onValueChange,
  ...input
}: Omit<ComponentProps<typeof Input>, "id" | "onChange"> & {
  readonly description?: ReactNode;
  readonly issue?: IssueCode;
  readonly label: ReactNode;
  /** Gets the field's `name` back, so one stable handler can serve a form. */
  readonly onValueChange: (value: string, name: string) => void;
}) {
  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) =>
      onValueChange(event.currentTarget.value, event.currentTarget.name),
    [onValueChange]
  );
  return (
    <FieldShell description={description} issue={issue} label={label}>
      {(control) => <Input {...input} {...control} onChange={handleChange} />}
    </FieldShell>
  );
}

export function TextAreaField({
  description,
  issue,
  label,
  onValueChange,
  ...textarea
}: Omit<ComponentProps<typeof Textarea>, "id" | "onChange"> & {
  readonly description?: ReactNode;
  readonly issue?: IssueCode;
  readonly label: ReactNode;
  /** Gets the field's `name` back, so one stable handler can serve a form. */
  readonly onValueChange: (value: string, name: string) => void;
}) {
  const handleChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) =>
      onValueChange(event.currentTarget.value, event.currentTarget.name),
    [onValueChange]
  );
  return (
    <FieldShell description={description} issue={issue} label={label}>
      {(control) => (
        <Textarea {...textarea} {...control} onChange={handleChange} />
      )}
    </FieldShell>
  );
}

/** The issue for a field path, if any. */
export const issueAt = (
  issues: FormIssues,
  path: string
): IssueCode | undefined => issues[path];
