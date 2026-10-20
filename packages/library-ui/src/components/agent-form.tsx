"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import type { FileId, LibraryItemId } from "@workspace/contract/schemas/common";
import type { AgentDefinition } from "@workspace/contract/schemas/library";
import type { ModelOption } from "@workspace/contract/schemas/models";
import type { SandboxProvider } from "@workspace/contract/schemas/sandbox";
import {
  PaperclipIcon,
  PlusIcon,
  SparklesIcon,
  ToolIcon,
  XIcon,
} from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
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
import { Switch } from "@workspace/ui/components/switch";
import { type ChangeEvent, type ReactNode, useCallback, useId } from "react";

import type { FormIssues } from "../form";
import { EditorSection } from "./editor-shell";
import { issueAt, TextAreaField } from "./fields";

// The Agent Builder's form (D13, 010, 192): instructions, conversation
// starters, knowledge, capabilities, connections (MCP servers and skills),
// then the model and sandbox, as titled sections in the order ChatGPT's GPT
// builder uses. Controlled and stateless: the builder owns the draft.

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
  const toolHints: Record<(typeof BUILTIN_TOOLS)[number], string> = {
    bash: t`Write and run code, and load skills.`,
    file_search: t`Look things up in the knowledge files.`,
    web_search: t`Find current information online.`,
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
    <>
      <EditorSection
        description={t`What the agent is for and how it should behave. People who can only use the agent never see this.`}
        title={<Trans>Instructions</Trans>}
      >
        <TextAreaField
          className="min-h-64 font-mono text-sm leading-relaxed"
          issue={issueAt(issues, "definition.instructions")}
          label={<span className="sr-only">{t`Instructions`}</span>}
          name="instructions"
          onValueChange={setInstructions}
          placeholder={t`You help people… Always… Never…`}
          readOnly={readOnly}
          value={value.instructions}
        />
      </EditorSection>

      <EditorSection
        description={t`Suggestions shown when a chat with the agent starts.`}
        title={<Trans>Conversation starters</Trans>}
      >
        {value.conversationStarters.length > 0 ? (
          <div className="flex flex-col gap-2">
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
          </div>
        ) : null}
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
      </EditorSection>

      <EditorSection
        description={t`Searched with file search. Only people who can view the agent can read them.`}
        title={<Trans>Knowledge</Trans>}
      >
        {value.knowledgeFileIds.length > 0 ? (
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
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
        ) : (
          <p className="rounded-lg border border-border border-dashed px-4 py-6 text-center text-muted-foreground text-sm">
            <Trans>No files yet.</Trans>
          </p>
        )}
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
      </EditorSection>

      <EditorSection
        description={t`Built-in tools the agent may call.`}
        title={<Trans>Capabilities</Trans>}
      >
        <ToggleList label={t`Capabilities`}>
          {BUILTIN_TOOLS.map((tool) => (
            <SwitchRow
              checked={value.tools.includes(tool)}
              description={toolHints[tool]}
              disabled={readOnly}
              id={tool}
              key={tool}
              label={toolLabels[tool]}
              onToggle={toggleTool}
            />
          ))}
        </ToggleList>
      </EditorSection>

      <EditorSection
        description={t`MCP servers and skills from your library.`}
        title={<Trans>Connections</Trans>}
      >
        <div className="flex flex-col gap-2">
          <h3 className="font-medium text-muted-foreground text-xs">
            <Trans>MCP servers</Trans>
          </h3>
          {mcpServers.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              <Trans>
                Add an MCP server to your library to connect it here.
              </Trans>
            </p>
          ) : (
            <ToggleList label={t`MCP servers`}>
              {mcpServers.map((server) => (
                <SwitchRow
                  checked={value.mcpServers.some(
                    (each) => each.id === server.id
                  )}
                  disabled={readOnly}
                  icon={<ToolIcon />}
                  id={server.id}
                  key={server.id}
                  label={server.name}
                  onToggle={toggleServer}
                />
              ))}
            </ToggleList>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="font-medium text-muted-foreground text-xs">
            <Trans>Skills</Trans>
          </h3>
          {skills.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              <Trans>Build a skill to load it into this agent's sandbox.</Trans>
            </p>
          ) : (
            <ToggleList label={t`Skills`}>
              {skills.map((skill) => (
                <SwitchRow
                  checked={value.skills.some((each) => each.id === skill.id)}
                  disabled={readOnly}
                  icon={<SparklesIcon />}
                  id={skill.id}
                  key={skill.id}
                  label={skill.name}
                  onToggle={toggleSkill}
                />
              ))}
            </ToggleList>
          )}
        </div>
      </EditorSection>

      <EditorSection title={<Trans>Model and runtime</Trans>}>
        <FieldGroup className="gap-5 sm:flex-row">
          <Field className="min-w-0 flex-1">
            <FieldLabel htmlFor={modelId}>
              <Trans>Model</Trans>
            </FieldLabel>
            <Select
              disabled={readOnly}
              items={modelItems}
              onValueChange={setModel}
              value={value.model}
            >
              <SelectTrigger className="w-full" id={modelId}>
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
          <Field className="min-w-0 flex-1">
            <FieldLabel htmlFor={sandboxId}>
              <Trans>Sandbox</Trans>
            </FieldLabel>
            <Select
              disabled={readOnly}
              items={sandboxItems}
              onValueChange={setSandbox}
              value={value.sandboxProvider ?? NO_SANDBOX}
            >
              <SelectTrigger className="w-full" id={sandboxId}>
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
      </EditorSection>
    </>
  );
}

/** A bordered list of switch rows, like settings. */
function ToggleList({
  children,
  label,
}: {
  readonly children: ReactNode;
  readonly label: string;
}) {
  return (
    <ul
      aria-label={label}
      className="flex flex-col divide-y divide-border rounded-lg border border-border"
    >
      {children}
    </ul>
  );
}

function SwitchRow({
  checked,
  description,
  disabled,
  icon,
  id,
  label,
  onToggle,
}: {
  readonly checked: boolean;
  readonly description?: string;
  readonly disabled?: boolean;
  readonly icon?: ReactNode;
  readonly id: string;
  readonly label: string;
  readonly onToggle: (id: string, on: boolean) => void;
}) {
  const controlId = useId();
  const hintId = useId();
  const handleChange = useCallback(
    (next: boolean) => onToggle(id, next),
    [id, onToggle]
  );
  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      {icon ? (
        <span
          aria-hidden
          className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground [&_svg]:size-3.5"
        >
          {icon}
        </span>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <label className="truncate text-sm" htmlFor={controlId}>
          {label}
        </label>
        {description ? (
          <p className="text-muted-foreground text-xs" id={hintId}>
            {description}
          </p>
        ) : null}
      </div>
      <Switch
        aria-describedby={description ? hintId : undefined}
        checked={checked}
        disabled={disabled}
        id={controlId}
        onCheckedChange={handleChange}
      />
    </li>
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
    <li className="flex items-center gap-2 px-3 py-2 text-sm">
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
