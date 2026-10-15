"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { CodeView } from "@workspace/code-ui/code-view";
import { FileTree } from "@workspace/code-ui/file-tree";
import type { FileId } from "@workspace/contract/schemas/common";
import type { SkillDefinition } from "@workspace/contract/schemas/library";
import {
  EyeIcon,
  FileTextIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  XIcon,
} from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@workspace/ui/components/field";
import { Markdown } from "@workspace/ui/components/markdown";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { Textarea } from "@workspace/ui/components/textarea";
import { cn } from "@workspace/ui/lib/utils";
import { type ChangeEvent, useCallback, useMemo, useState } from "react";

import type { FormIssues, IssueCode } from "../form";
import {
  readSkillMd,
  SKILL_DESCRIPTION_HINT,
  SKILL_DESCRIPTION_MAX,
  SKILL_NAME_MAX,
  type SkillFields,
  skillFieldIssues,
  withSkillField,
} from "../skill-md";
import { issueAt, TextAreaField, TextField } from "./fields";

// The Skill builder (D13): the Agent Skills format, a `SKILL.md` with
// frontmatter plus bundled scripts and resources. It's edited as fields
// (name, description, instructions; 170) bound to SKILL.md, or as the raw
// file behind "Edit as SKILL.md". Files are uploads the page
// adds (`onAddFiles`); the viewer reads them through `loadFile`. Testing in
// a sandbox is the page's call too (`onTestInSandbox`).

export const SKILL_MD = "SKILL.md";

export interface SkillFormProps {
  readonly issues: FormIssues;
  readonly onAddFiles?: () => Promise<SkillDefinition["files"]>;
  readonly onChange: (next: SkillDefinition) => void;
  readonly readOnly?: boolean;
  readonly value: SkillDefinition;
}

type Mode = "fields" | "raw";
type FieldName = keyof SkillFields;

/** Words for a field's issue, more precise than the generic ones. */
const useSkillIssueText = () => {
  const { t } = useLingui();
  return (field: "description" | "name", code: IssueCode | undefined) => {
    if (code === "too_long") {
      return field === "name"
        ? t`Keep the name to ${SKILL_NAME_MAX} characters or fewer.`
        : t`Keep the description to ${SKILL_DESCRIPTION_MAX} characters or fewer.`;
    }
    if (code === "invalid_format") {
      return t`Start with a letter or number; use letters, numbers, spaces, hyphens and underscores.`;
    }
    if (code === "required") {
      return field === "name"
        ? t`Give the skill a name.`
        : t`Say what the skill does and when to use it.`;
    }
  };
};

export function SkillForm({
  issues,
  onAddFiles,
  onChange,
  readOnly = false,
  value,
}: SkillFormProps) {
  const { t } = useLingui();
  const [mode, setMode] = useState<Mode>("fields");
  const setSkillMd = useCallback(
    (skillMd: string) => onChange({ ...value, skillMd }),
    [onChange, value]
  );
  const removeFile = useCallback(
    (path: string) =>
      onChange({
        ...value,
        files: value.files.filter((each) => each.path !== path),
      }),
    [onChange, value]
  );
  const addFiles = useCallback(async () => {
    const added = (await onAddFiles?.()) ?? [];
    const paths = new Set(added.map((file) => file.path));
    onChange({
      ...value,
      files: [...value.files.filter((file) => !paths.has(file.path)), ...added],
    });
  }, [onAddFiles, onChange, value]);
  const toggleMode = useCallback(
    () => setMode((current) => (current === "fields" ? "raw" : "fields")),
    []
  );

  return (
    <FieldGroup>
      <div className="flex items-center justify-end">
        <Button
          aria-pressed={mode === "raw"}
          onClick={toggleMode}
          size="sm"
          variant="ghost"
        >
          <FileTextIcon data-icon="inline-start" />
          {mode === "raw" ? (
            <Trans>Edit as fields</Trans>
          ) : (
            <Trans>Edit as SKILL.md</Trans>
          )}
        </Button>
      </div>
      {mode === "raw" ? (
        <TextAreaField
          className="min-h-72 font-mono text-sm"
          description={t`Frontmatter with a name and description, then the instructions the agent follows.`}
          issue={issueAt(issues, "definition.skillMd")}
          label={SKILL_MD}
          name="skillMd"
          onValueChange={setSkillMd}
          readOnly={readOnly}
          spellCheck={false}
          value={value.skillMd}
        />
      ) : (
        <SkillFieldsForm
          issues={issues}
          onSkillMd={setSkillMd}
          readOnly={readOnly}
          skillMd={value.skillMd}
        />
      )}
      <FieldSet>
        <FieldLegend variant="label">
          <Trans>Files</Trans>
        </FieldLegend>
        <FieldDescription>
          <Trans>Scripts and resources the skill refers to, by path.</Trans>
        </FieldDescription>
        {value.files.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {value.files.map((file) => (
              <FileRow
                key={file.path}
                onRemove={readOnly ? undefined : removeFile}
                path={file.path}
              />
            ))}
          </ul>
        ) : null}
        {onAddFiles && !readOnly ? (
          <Button
            className="self-start"
            onClick={addFiles}
            size="sm"
            variant="outline"
          >
            <PlusIcon data-icon="inline-start" />
            <Trans>Add files</Trans>
          </Button>
        ) : null}
      </FieldSet>
    </FieldGroup>
  );
}

/**
 * Name, description and instructions, each bound to its part of SKILL.md.
 * Issues show as you type: once a field has been touched, or once a save
 * was tried (`issues` from the builder).
 */
function SkillFieldsForm({
  issues,
  onSkillMd,
  readOnly,
  skillMd,
}: {
  readonly issues: FormIssues;
  readonly onSkillMd: (skillMd: string) => void;
  readonly readOnly: boolean;
  readonly skillMd: string;
}) {
  const { t } = useLingui();
  const issueText = useSkillIssueText();
  const fields = useMemo(() => readSkillMd(skillMd), [skillMd]);
  const live = useMemo(() => skillFieldIssues(fields), [fields]);
  const [touched, setTouched] = useState<ReadonlySet<FieldName>>(new Set());
  const [preview, setPreview] = useState(false);
  const change = useCallback(
    (next: string, name: string) => {
      const field = name as FieldName;
      setTouched((current) =>
        current.has(field) ? current : new Set([...current, field])
      );
      onSkillMd(withSkillField(skillMd, field, next));
    },
    [onSkillMd, skillMd]
  );
  const shown = (field: "description" | "name") =>
    touched.has(field) || issues[`definition.skillMd.${field}`]
      ? live[field]
      : undefined;
  const nameIssue = shown("name");
  const descriptionIssue = shown("description");
  const descriptionLength = fields.description.trim().length;
  const togglePreview = useCallback(() => setPreview((on) => !on), []);

  return (
    <>
      <TextField
        autoComplete="off"
        description={t`What people see when they pick it, like Code review checklist.`}
        issue={nameIssue}
        issueText={issueText("name", nameIssue)}
        label={t`Name`}
        maxLength={SKILL_NAME_MAX * 2}
        name="name"
        onValueChange={change}
        placeholder={t`Name your skill`}
        readOnly={readOnly}
        value={fields.name}
      />
      <TextAreaField
        className="min-h-20"
        description={
          <span className="flex justify-between gap-3">
            <span>
              <Trans>
                When to use it: the model reads this to decide whether the skill
                fits the task. Say what it does and when, like “Use when
                reviewing a pull request.”
              </Trans>
            </span>
            <span
              className={cn(
                "shrink-0 tabular-nums",
                descriptionLength > 0 &&
                  descriptionLength < SKILL_DESCRIPTION_HINT &&
                  "text-foreground"
              )}
            >
              {descriptionLength}/{SKILL_DESCRIPTION_MAX}
            </span>
          </span>
        }
        issue={descriptionIssue}
        issueText={issueText("description", descriptionIssue)}
        label={t`Description`}
        name="description"
        onValueChange={change}
        placeholder={t`Reviews code for bugs and style. Use when asked to review a diff or pull request.`}
        readOnly={readOnly}
        value={fields.description}
      />
      <Field>
        <div className="flex items-center justify-between gap-2">
          <FieldLabel htmlFor={instructionsId(preview)}>
            <Trans>Instructions</Trans>
          </FieldLabel>
          <Button
            aria-pressed={preview}
            onClick={togglePreview}
            size="xs"
            variant="ghost"
          >
            {preview ? (
              <PencilIcon data-icon="inline-start" />
            ) : (
              <EyeIcon data-icon="inline-start" />
            )}
            {preview ? <Trans>Write</Trans> : <Trans>Preview</Trans>}
          </Button>
        </div>
        {preview ? (
          <div
            className="min-h-72 rounded-lg border border-border px-3 py-2 text-sm"
            id={instructionsId(true)}
          >
            {fields.instructions.trim() ? (
              <Markdown>{fields.instructions}</Markdown>
            ) : (
              <p className="text-muted-foreground">
                <Trans>Nothing to preview yet.</Trans>
              </p>
            )}
          </div>
        ) : (
          <InstructionsEditor
            onValueChange={change}
            readOnly={readOnly}
            value={fields.instructions}
          />
        )}
        <FieldDescription>
          <Trans>
            Markdown. What the model follows when the skill is used: steps,
            rules and examples.
          </Trans>
        </FieldDescription>
      </Field>
    </>
  );
}

const instructionsId = (preview: boolean) =>
  preview ? "skill-instructions-preview" : "skill-instructions";

function InstructionsEditor({
  onValueChange,
  readOnly,
  value,
}: {
  readonly onValueChange: (value: string, name: string) => void;
  readonly readOnly: boolean;
  readonly value: string;
}) {
  const { t } = useLingui();
  const handle = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) =>
      onValueChange(event.currentTarget.value, "instructions"),
    [onValueChange]
  );
  return (
    <Textarea
      className="min-h-72 font-mono text-sm"
      id={instructionsId(false)}
      onChange={handle}
      placeholder={t`# My skill

1. First, …
2. Then, …`}
      readOnly={readOnly}
      spellCheck={false}
      value={value}
    />
  );
}

function FileRow({
  onRemove,
  path,
}: {
  readonly onRemove?: (path: string) => void;
  readonly path: string;
}) {
  const { t } = useLingui();
  const remove = useCallback(() => onRemove?.(path), [onRemove, path]);
  return (
    <li className="flex items-center gap-2">
      <code className="min-w-0 flex-1 truncate font-mono text-sm">{path}</code>
      {onRemove ? (
        <Button
          aria-label={t`Remove ${path}`}
          onClick={remove}
          size="icon-xs"
          variant="ghost"
        >
          <XIcon />
        </Button>
      ) : null}
    </li>
  );
}

export interface SkillFilesProps {
  /** Reads a bundled file's text; without it only `SKILL.md` shows. */
  readonly loadFile?: (fileId: FileId) => Promise<string>;
  readonly onTestInSandbox?: (definition: SkillDefinition) => void;
  readonly value: SkillDefinition;
}

/** The skill as a file tree, with the selected file shown read-only. */
export function SkillFiles({
  loadFile,
  onTestInSandbox,
  value,
}: SkillFilesProps) {
  const { t } = useLingui();
  const [selected, setSelected] = useState(SKILL_MD);
  const paths = [SKILL_MD, ...value.files.map((each) => each.path)];
  const file = value.files.find((each) => each.path === selected);
  const contents = useQuery({
    enabled: file !== undefined && loadFile !== undefined,
    queryFn: () => loadFile?.(file?.fileId as FileId) ?? "",
    queryKey: ["skill-file", file?.fileId],
  });
  const shown = file ? contents.data : value.skillMd;
  const select = useCallback((next: readonly string[]) => {
    const [first] = next;
    if (first) {
      setSelected(first);
    }
  }, []);
  const test = useCallback(
    () => onTestInSandbox?.(value),
    [onTestInSandbox, value]
  );

  return (
    <section
      aria-label={t`Skill files`}
      className="flex h-full min-h-0 flex-col gap-3"
    >
      <header className="flex items-center justify-between gap-2">
        <h2 className="font-medium text-sm">
          <Trans>Files</Trans>
        </h2>
        {onTestInSandbox ? (
          <Button onClick={test} size="sm" variant="outline">
            <PlayIcon data-icon="inline-start" />
            <Trans>Test in sandbox</Trans>
          </Button>
        ) : null}
      </header>
      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[14rem_1fr]">
        <FileTree
          className="min-h-40 rounded-lg border border-border"
          label={t`Skill files`}
          onSelectionChange={select}
          paths={paths}
        />
        <div className="min-h-0 overflow-auto rounded-lg border border-border">
          {shown === undefined ? (
            <div className="flex flex-col gap-2 p-3">
              {file && !loadFile ? (
                <p className="text-muted-foreground text-sm">
                  <Trans>This file can't be shown here.</Trans>
                </p>
              ) : (
                <Skeleton className="h-24" />
              )}
            </div>
          ) : (
            <CodeView contents={shown} path={selected} wrap />
          )}
        </div>
      </div>
    </section>
  );
}
