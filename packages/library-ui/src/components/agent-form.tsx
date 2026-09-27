"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import type { FileId, LibraryItemId } from "@workspace/contract/schemas/common";
import type { AgentDefinition } from "@workspace/contract/schemas/library";
import type { ModelOption } from "@workspace/contract/schemas/models";
import type { SandboxProvider } from "@workspace/contract/schemas/sandbox";
import { PaperclipIcon, PlusIcon, XIcon } from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import { Checkbox } from "@workspace/ui/components/checkbox";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { type ChangeEvent, useCallback, useId } from "react";

import type { FormIssues } from "../form";
import { issueAt, TextAreaField } from "./fields";

// The Agent Builder's form (D13, 010): instructions, model, tools, MCP
// servers, skills, knowledge files, conversation starters and the sandbox
// provider. Controlled and stateless: the builder owns the draft.

export interface Choice {
  readonly id: LibraryItemId;
  readonly name: string;
}

export interface KnowledgeFile {
  readonly id: FileId;
  readonly name: string;
}

export interface AgentFormProps {
  readonly issues: FormIssues;
  /** Names for attached knowledge files, when the page knows them. */
  readonly knowledgeFiles?: readonly KnowledgeFile[];
  /** MCP servers the caller can use. */
  readonly mcpServers: readonly Choice[];
  readonly models: readonly ModelOption[];
  readonly onAddKnowledge?: () => Promise<readonly KnowledgeFile[]>;
  readonly onChange: (next: AgentDefinition) => void;
  readonly readOnly?: boolean;
  readonly sandboxProviders: readonly SandboxProvider[];
  /** Skills the caller can use. */
  readonly skills: readonly Choice[];
  readonly value: AgentDefinition;
}

/** Built-in tools an agent can switch on; the server drops what it can't serve. */
const BUILTIN_TOOLS = ["web_search", "file_search", "bash"] as const;

const MAX_STARTERS = 8;
const NO_SANDBOX = "none";
const NO_KNOWLEDGE: readonly KnowledgeFile[] = [];

const without = <T,>(list: readonly T[], item: T): T[] =>
  list.filter((each) => each !== item);

export function AgentForm({
  issues,
  knowledgeFiles = NO_KNOWLEDGE,
  mcpServers,
  models,
  onAddKnowledge,
  onChange,
  readOnly = false,
  sandboxProviders,
  skills,
  value,
}: AgentFormProps) {
  const { t } = useLingui();
  const toolLabels: Record<(typeof BUILTIN_TOOLS)[number], string> = {
    bash: t`Run code in the sandbox`,
    file_search: t`Search knowledge files`,
    web_search: t`Search the web`,
  };
  const modelItems = models.map((model) => ({
    label: model.label,
    value: model.selector,
  }));
  if (!modelItems.some((item) => item.value === value.model)) {
    modelItems.push({ label: value.model, value: value.model });
  }
  const sandboxItems = [
    { label: t`No sandbox`, value: NO_SANDBOX },
    ...sandboxProviders.map((provider) => ({
      label: provider,
      value: provider,
    })),
  ];
  const modelId = useId();
  const sandboxId = useId();

  const setInstructions = useCallback(
    (instructions: string) => onChange({ ...value, instructions }),
    [onChange, value]
  );
  const setModel = useCallback(
    (model: unknown) => {
      if (typeof model === "string") {
        onChange({ ...value, model });
      }
    },
    [onChange, value]
  );
  const setSandbox = useCallback(
    (provider: unknown) =>
      onChange({
        ...value,
        sandboxProvider:
          provider === NO_SANDBOX || typeof provider !== "string"
            ? null
            : (provider as SandboxProvider),
      }),
    [onChange, value]
  );
  const toggleTool = useCallback(
    (tool: string, on: boolean) =>
      onChange({
        ...value,
        tools: on
          ? [...without(value.tools, tool), tool]
          : without(value.tools, tool),
      }),
    [onChange, value]
  );
  const toggleServer = useCallback(
    (id: string, on: boolean) =>
      onChange({
        ...value,
        mcpServers: on
          ? [...value.mcpServers, { id: id as LibraryItemId }]
          : value.mcpServers.filter((each) => each.id !== id),
      }),
    [onChange, value]
  );
  const toggleSkill = useCallback(
    (id: string, on: boolean) =>
      onChange({
        ...value,
        skills: on
          ? [...value.skills, { id: id as LibraryItemId }]
          : value.skills.filter((each) => each.id !== id),
      }),
    [onChange, value]
  );
  const removeFile = useCallback(
    (id: FileId) =>
      onChange({
        ...value,
        knowledgeFileIds: without(value.knowledgeFileIds, id),
      }),
    [onChange, value]
  );
  const addFiles = useCallback(async () => {
    const added = (await onAddKnowledge?.()) ?? [];
    onChange({
      ...value,
      knowledgeFileIds: [
        ...new Set([
          ...value.knowledgeFileIds,
          ...added.map((file) => file.id),
        ]),
      ],
    });
  }, [onAddKnowledge, onChange, value]);
  const setStarter = useCallback(
    (index: number, text: string) =>
      onChange({
        ...value,
        conversationStarters: value.conversationStarters.map((each, i) =>
          i === index ? text : each
        ),
      }),
    [onChange, value]
  );
  const removeStarter = useCallback(
    (index: number) =>
      onChange({
        ...value,
        conversationStarters: value.conversationStarters.filter(
          (_, i) => i !== index
        ),
      }),
    [onChange, value]
  );
  const addStarter = useCallback(
    () =>
      onChange({
        ...value,
        conversationStarters: [...value.conversationStarters, ""],
      }),
    [onChange, value]
  );

  return (
    <FieldGroup>
      <TextAreaField
        className="min-h-48 font-mono text-sm"
        description={t`What the agent is for and how it should behave. People who can only use the agent never see this.`}
        issue={issueAt(issues, "definition.instructions")}
        label={t`Instructions`}
        name="instructions"
        onValueChange={setInstructions}
        readOnly={readOnly}
        value={value.instructions}
      />

      <Field>
        <FieldLabel htmlFor={modelId}>
          <Trans>Model</Trans>
        </FieldLabel>
        <Select
          disabled={readOnly}
          items={modelItems}
          onValueChange={setModel}
          value={value.model}
        >
          <SelectTrigger className="w-full max-w-xs" id={modelId}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {modelItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <FieldDescription>
          <Trans>An alias follows whatever the instance maps it to.</Trans>
        </FieldDescription>
      </Field>

      <FieldSet>
        <FieldLegend variant="label">
          <Trans>Tools</Trans>
        </FieldLegend>
        {BUILTIN_TOOLS.map((tool) => (
          <CheckRow
            checked={value.tools.includes(tool)}
            disabled={readOnly}
            id={tool}
            key={tool}
            label={toolLabels[tool]}
            onToggle={toggleTool}
          />
        ))}
      </FieldSet>

      <FieldSet>
        <FieldLegend variant="label">
          <Trans>MCP servers</Trans>
        </FieldLegend>
        {mcpServers.length === 0 ? (
          <FieldDescription>
            <Trans>Add an MCP server to your library to connect it here.</Trans>
          </FieldDescription>
        ) : (
          mcpServers.map((server) => (
            <CheckRow
              checked={value.mcpServers.some((each) => each.id === server.id)}
              disabled={readOnly}
              id={server.id}
              key={server.id}
              label={server.name}
              onToggle={toggleServer}
            />
          ))
        )}
      </FieldSet>

      <FieldSet>
        <FieldLegend variant="label">
          <Trans>Skills</Trans>
        </FieldLegend>
        {skills.length === 0 ? (
          <FieldDescription>
            <Trans>Build a skill to load it into this agent's sandbox.</Trans>
          </FieldDescription>
        ) : (
          skills.map((skill) => (
            <CheckRow
              checked={value.skills.some((each) => each.id === skill.id)}
              disabled={readOnly}
              id={skill.id}
              key={skill.id}
              label={skill.name}
              onToggle={toggleSkill}
            />
          ))
        )}
      </FieldSet>

      <FieldSet>
        <FieldLegend variant="label">
          <Trans>Knowledge files</Trans>
        </FieldLegend>
        <FieldDescription>
          <Trans>
            Searched with file search. Only people who can view the agent can
            read them.
          </Trans>
        </FieldDescription>
        {value.knowledgeFileIds.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {value.knowledgeFileIds.map((id) => (
              <KnowledgeRow
                id={id}
                key={id}
                name={
                  knowledgeFiles.find((file) => file.id === id)?.name ??
                  t`Attached file`
                }
                onRemove={readOnly ? undefined : removeFile}
              />
            ))}
          </ul>
        ) : null}
        {onAddKnowledge && !readOnly ? (
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

      <FieldSet>
        <FieldLegend variant="label">
          <Trans>Conversation starters</Trans>
        </FieldLegend>
        {value.conversationStarters.map((starter, index) => (
          <StarterRow
            index={index}
            invalid={Boolean(
              issueAt(issues, `definition.conversationStarters.${index}`)
            )}
            // Starters have no ids; position is their identity while editing.
            // biome-ignore lint/suspicious/noArrayIndexKey: see above.
            key={index}
            onChange={setStarter}
            onRemove={removeStarter}
            readOnly={readOnly}
            value={starter}
          />
        ))}
        {readOnly ||
        value.conversationStarters.length >= MAX_STARTERS ? null : (
          <Button
            className="self-start"
            onClick={addStarter}
            size="sm"
            variant="outline"
          >
            <PlusIcon data-icon="inline-start" />
            <Trans>Add a starter</Trans>
          </Button>
        )}
      </FieldSet>

      <Field>
        <FieldLabel htmlFor={sandboxId}>
          <Trans>Sandbox</Trans>
        </FieldLabel>
        <Select
          disabled={readOnly}
          items={sandboxItems}
          onValueChange={setSandbox}
          value={value.sandboxProvider ?? NO_SANDBOX}
        >
          <SelectTrigger className="w-full max-w-xs" id={sandboxId}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {sandboxItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <FieldDescription>
          <Trans>Where the agent runs code and loads its skills.</Trans>
        </FieldDescription>
      </Field>
    </FieldGroup>
  );
}

function CheckRow({
  checked,
  disabled,
  id,
  label,
  onToggle,
}: {
  readonly checked: boolean;
  readonly disabled?: boolean;
  readonly id: string;
  readonly label: string;
  readonly onToggle: (id: string, on: boolean) => void;
}) {
  const controlId = useId();
  const handleChange = useCallback(
    (next: boolean) => onToggle(id, next),
    [id, onToggle]
  );
  return (
    <Field orientation="horizontal">
      <Checkbox
        checked={checked}
        disabled={disabled}
        id={controlId}
        onCheckedChange={handleChange}
      />
      <FieldLabel className="font-normal" htmlFor={controlId}>
        {label}
      </FieldLabel>
    </Field>
  );
}

function KnowledgeRow({
  id,
  name,
  onRemove,
}: {
  readonly id: FileId;
  readonly name: string;
  readonly onRemove?: (id: FileId) => void;
}) {
  const { t } = useLingui();
  const remove = useCallback(() => onRemove?.(id), [id, onRemove]);
  return (
    <li className="flex items-center gap-2 text-sm">
      <PaperclipIcon className="size-4 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{name}</span>
      {onRemove ? (
        <Button
          aria-label={t`Remove ${name}`}
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

function StarterRow({
  index,
  invalid,
  onChange,
  onRemove,
  readOnly,
  value,
}: {
  readonly index: number;
  readonly invalid: boolean;
  readonly onChange: (index: number, value: string) => void;
  readonly onRemove: (index: number) => void;
  readonly readOnly: boolean;
  readonly value: string;
}) {
  const { t } = useLingui();
  const position = index + 1;
  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) =>
      onChange(index, event.currentTarget.value),
    [index, onChange]
  );
  const remove = useCallback(() => onRemove(index), [index, onRemove]);
  return (
    <div className="flex items-center gap-2">
      <Input
        aria-invalid={invalid || undefined}
        aria-label={t`Starter ${position}`}
        onChange={handleChange}
        readOnly={readOnly}
        value={value}
      />
      {readOnly ? null : (
        <Button
          aria-label={t`Remove starter ${position}`}
          onClick={remove}
          size="icon-sm"
          variant="ghost"
        >
          <XIcon />
        </Button>
      )}
    </div>
  );
}
