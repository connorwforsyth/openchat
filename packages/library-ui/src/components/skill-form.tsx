"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { CodeView } from "@workspace/code-ui/code-view";
import { FileTree } from "@workspace/code-ui/file-tree";
import type { FileId } from "@workspace/contract/schemas/common";
import type { SkillDefinition } from "@workspace/contract/schemas/library";
import { FileIcon, PlayIcon, PlusIcon, XIcon } from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import { FieldGroup } from "@workspace/ui/components/field";
import { Skeleton } from "@workspace/ui/components/skeleton";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@workspace/ui/components/toggle-group";
import { useCallback, useState } from "react";

import type { FormIssues, IssueCode } from "../form";
import {
  composeSkillMd,
  parseSkillMdParts,
  SKILL_DESCRIPTION_MAX,
  SKILL_NAME_MAX,
  type SkillMdParts,
  skillDescriptionIssue,
  skillNameIssue,
  slugifySkillName,
} from "../skill-md";
import { EditorSection } from "./editor-shell";
import { issueAt, TextAreaField, TextField } from "./fields";

// The Skill builder (D13, 192): the Agent Skills format, a `SKILL.md` with
// frontmatter plus bundled scripts and resources. Like ChatGPT's skill
// editor, the frontmatter's name and description are fields and the rest is
// the instructions; the raw file is one switch away. Files are uploads the page
// adds (`onAddFiles`); the viewer reads them through `loadFile`. Testing in
// a sandbox is the page's call too (`onTestInSandbox`).

export const SKILL_MD = "SKILL.md";

export interface SkillFormProps {
  readonly issues: FormIssues;
  /** The item's display name, to suggest a skill name from. */
  readonly itemName?: string;
  readonly onAddFiles?: () => Promise<SkillDefinition["files"]>;
  readonly onChange: (next: SkillDefinition) => void;
  readonly readOnly?: boolean;
  readonly value: SkillDefinition;
}

type SkillMdMode = "fields" | "raw";

export function SkillForm({
  issues,
  itemName = "",
  onAddFiles,
  onChange,
  readOnly = false,
  value,
}: SkillFormProps) {
  const { t } = useLingui();
  const parts = parseSkillMdParts(value.skillMd);
  const [chosenMode, setMode] = useState<SkillMdMode>("fields");
  // Frontmatter the fields can't hold safely is only edited as the file.
  const mode: SkillMdMode = parts.structured ? chosenMode : "raw";
  const setSkillMd = useCallback(
    (skillMd: string) => onChange({ ...value, skillMd }),
    [onChange, value]
  );
  const setPart = useCallback(
    (text: string, field: string) => {
      if (field !== "name" && field !== "description" && field !== "body") {
        return;
      }
      const { structured: _, ...current } = parseSkillMdParts(value.skillMd);
      onChange({
        ...value,
        skillMd: composeSkillMd({ ...current, [field]: text }),
      });
    },
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
  const chooseMode = useCallback((values: string[]) => {
    const [next] = values;
    if (next === "fields" || next === "raw") {
      setMode(next);
    }
  }, []);

  return (
    <>
      <EditorSection
        action={
          <ToggleGroup
            aria-label={t`How to edit SKILL.md`}
            onValueChange={chooseMode}
            size="sm"
            value={[mode]}
            variant="outline"
          >
            <ToggleGroupItem disabled={!parts.structured} value="fields">
              <Trans>Fields</Trans>
            </ToggleGroupItem>
            <ToggleGroupItem value="raw">{SKILL_MD}</ToggleGroupItem>
          </ToggleGroup>
        }
        description={t`Agents read the name and description to decide when to load the skill, then follow its instructions.`}
        title={<Trans>Skill</Trans>}
      >
        {mode === "fields" ? (
          <SkillFields
            bodyIssue={issueAt(issues, "definition.skillMd")}
            itemName={itemName}
            onPart={setPart}
            parts={parts}
            readOnly={readOnly}
          />
        ) : (
          <TextAreaField
            className="min-h-96 font-mono text-sm"
            description={
              parts.structured
                ? t`Frontmatter with a name and description, then the instructions the agent follows.`
                : t`This frontmatter spans several lines, so it's edited as the file.`
            }
            issue={issueAt(issues, "definition.skillMd")}
            label={SKILL_MD}
            name="skillMd"
            onValueChange={setSkillMd}
            readOnly={readOnly}
            spellCheck={false}
            value={value.skillMd}
          />
        )}
      </EditorSection>

      <EditorSection
        description={t`Scripts and resources the skill refers to, by path.`}
        title={<Trans>Files</Trans>}
      >
        {value.files.length > 0 ? (
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {value.files.map((file) => (
              <FileRow
                key={file.path}
                onRemove={readOnly ? undefined : removeFile}
                path={file.path}
              />
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border border-border border-dashed px-4 py-6 text-center text-muted-foreground text-sm">
            <Trans>Only {SKILL_MD} so far.</Trans>
          </p>
        )}
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
      </EditorSection>
    </>
  );
}

function SkillFields({
  bodyIssue,
  itemName,
  onPart,
  parts,
  readOnly,
}: {
  readonly bodyIssue?: IssueCode;
  readonly itemName: string;
  readonly onPart: (text: string, field: string) => void;
  readonly parts: SkillMdParts;
  readonly readOnly: boolean;
}) {
  const { t } = useLingui();
  const suggested = slugifySkillName(itemName);
  const applySuggested = useCallback(
    () => onPart(suggested, "name"),
    [onPart, suggested]
  );
  const descriptionLength = parts.description.length;
  return (
    <FieldGroup className="gap-5">
      <div className="flex flex-col gap-2">
        <TextField
          autoComplete="off"
          className="font-mono"
          description={t`Lowercase words joined by hyphens, up to ${SKILL_NAME_MAX} characters.`}
          issue={skillNameIssue(parts.name) ?? undefined}
          label={t`Skill name`}
          name="name"
          onValueChange={onPart}
          placeholder={suggested || "your-skill-name"}
          readOnly={readOnly}
          spellCheck={false}
          value={parts.name}
        />
        {!readOnly && parts.name === "" && suggested ? (
          <Button
            className="self-start"
            onClick={applySuggested}
            size="xs"
            variant="secondary"
          >
            <Trans>Use {suggested}</Trans>
          </Button>
        ) : null}
      </div>
      <TextAreaField
        className="min-h-20"
        description={t`${descriptionLength} of ${SKILL_DESCRIPTION_MAX} characters. Say what it does and when to use it.`}
        issue={skillDescriptionIssue(parts.description) ?? undefined}
        label={t`When to use it`}
        name="description"
        onValueChange={onPart}
        placeholder={t`Fills in PDF forms. Use when someone shares a PDF form.`}
        readOnly={readOnly}
        value={parts.description}
      />
      <TextAreaField
        className="min-h-80 font-mono text-sm leading-relaxed"
        issue={bodyIssue}
        label={t`Instructions`}
        name="body"
        onValueChange={onPart}
        placeholder={t`Step by step, what the agent should do. Refer to bundled files by path.`}
        readOnly={readOnly}
        spellCheck={false}
        value={parts.body}
      />
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
    <li className="flex items-center gap-2 px-3 py-2">
      <FileIcon className="size-4 text-muted-foreground" />
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
