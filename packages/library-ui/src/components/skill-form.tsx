"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { CodeView } from "@workspace/code-ui/code-view";
import { FileTree } from "@workspace/code-ui/file-tree";
import type { FileId } from "@workspace/contract/schemas/common";
import type { SkillDefinition } from "@workspace/contract/schemas/library";
import { PlayIcon, PlusIcon, XIcon } from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import {
  FieldDescription,
  FieldGroup,
  FieldLegend,
  FieldSet,
} from "@workspace/ui/components/field";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { useCallback, useState } from "react";

import type { FormIssues } from "../form";
import { issueAt, TextAreaField } from "./fields";

// The Skill builder (D13): the Agent Skills format, a `SKILL.md` with
// frontmatter plus bundled scripts and resources. Files are uploads the page
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

export function SkillForm({
  issues,
  onAddFiles,
  onChange,
  readOnly = false,
  value,
}: SkillFormProps) {
  const { t } = useLingui();
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

  return (
    <FieldGroup>
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
