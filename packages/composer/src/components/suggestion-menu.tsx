"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import {
  AgentIcon,
  AttachIcon,
  EyeIcon,
  FileIcon,
  FileTextIcon,
  NetworkIcon,
  PlusIcon,
  SparklesIcon,
  UserIcon,
} from "@workspace/icons";
import { cn } from "@workspace/ui/lib/utils";
import { type MouseEvent, useCallback, useEffect, useRef } from "react";

import { candidateKey } from "../mentions";
import type { MenuItem } from "../options";
import type { ComposerCommand } from "../schemas";
import { ARTIFACT_ICONS } from "./chip";

export const suggestionKey = (item: MenuItem): string => {
  switch (item.kind) {
    case "agent":
      return `agent:${item.agent.id}`;
    case "artifact":
      return `artifact:${item.artifact.kind}`;
    case "command":
      return `command:${item.command}`;
    case "mcp-server":
      return `mcp:${item.server.id}`;
    case "open-file":
      return `open:${item.file.path}`;
    case "mention":
      return candidateKey(item.candidate);
    case "prompt":
      return `prompt:${item.prompt.id}`;
    case "skill":
      return `skill:${item.skill.id}`;
    case "upload":
      return "upload";
    default:
      return item satisfies never;
  }
};

/** The menu's sections, in the order `menuItems` lists them. */
export type MenuGroup =
  | "agents"
  | "skills"
  | "prompts"
  | "make"
  | "people"
  | "files"
  | "upload"
  | "commands"
  | "mcp";

export const menuGroup = (item: MenuItem): MenuGroup => {
  switch (item.kind) {
    case "agent":
      return "agents";
    case "skill":
      return "skills";
    case "prompt":
      return "prompts";
    case "artifact":
      return "make";
    case "upload":
      return "upload";
    case "mention":
      return item.candidate.kind === "user" ? "people" : "files";
    case "open-file":
      return "files";
    case "command":
      return "commands";
    case "mcp-server":
      return "mcp";
    default:
      return item satisfies never;
  }
};

export const optionId = (listboxId: string, index: number) =>
  `${listboxId}-option-${index}`;

export interface SuggestionMenuProps {
  readonly activeIndex: number;
  readonly id: string;
  readonly items: readonly MenuItem[];
  /** What this instance calls MCP servers (191), for their section. */
  readonly mcpLabel: string;
  readonly onChoose: (index: number) => void;
  readonly onHover: (index: number) => void;
}

// Focus never leaves the textarea: it owns the keyboard (arrows, Enter,
// Escape) and points at the active option with aria-activedescendant, the
// ARIA pattern for autocomplete inside a text field. So options take pointer
// input only, and mousedown is cancelled to keep the caret where it was.
const keepFocus = (event: MouseEvent) => event.preventDefault();

const COMMAND_ICONS = {
  "new-file": PlusIcon,
  open: FileIcon,
  preview: EyeIcon,
} as const satisfies Record<ComposerCommand, unknown>;

function SuggestionIcon({ item }: { readonly item: MenuItem }) {
  switch (item.kind) {
    case "agent":
      return <AgentIcon aria-hidden />;
    case "artifact": {
      const Icon = ARTIFACT_ICONS[item.artifact.kind];
      return <Icon aria-hidden />;
    }
    case "command": {
      const Icon = COMMAND_ICONS[item.command];
      return <Icon aria-hidden />;
    }
    case "mcp-server":
      return <NetworkIcon aria-hidden />;
    case "open-file":
      return <FileIcon aria-hidden />;
    case "mention":
      return item.candidate.kind === "file" ? (
        <FileIcon aria-hidden />
      ) : (
        <UserIcon aria-hidden />
      );
    case "prompt":
      return <FileTextIcon aria-hidden />;
    case "skill":
      return <SparklesIcon aria-hidden />;
    case "upload":
      return <AttachIcon aria-hidden />;
    default:
      return item satisfies never;
  }
}

/** A name, with a quieter hint at the far end (a command, an email, a folder). */
function Labelled({
  draft = false,
  hint,
  label,
  mono = false,
}: {
  /** The owner's unpublished draft: only they see it. */
  readonly draft?: boolean;
  readonly hint?: string;
  readonly label: string;
  readonly mono?: boolean;
}) {
  return (
    <>
      <span className="truncate">{label}</span>
      {draft ? (
        <span className="shrink-0 rounded-sm bg-muted px-1 text-muted-foreground text-xs">
          <Trans>Draft</Trans>
        </span>
      ) : null}
      {hint ? (
        <span
          className={cn(
            "ms-auto text-muted-foreground text-xs",
            mono ? "shrink-0 font-mono" : "truncate"
          )}
        >
          {hint}
        </span>
      ) : null}
    </>
  );
}

function CommandText({ command }: { readonly command: ComposerCommand }) {
  const { t } = useLingui();
  const labels: Record<ComposerCommand, string> = {
    "new-file": t`New file`,
    open: t`Open file`,
    preview: t`Preview`,
  };
  return <Labelled hint={`/${command}`} label={labels[command]} mono />;
}

/** "Turn off Company docs", with "This chat" as the hint: it's a switch, not a mention. */
function ServerText({
  server,
}: {
  readonly server: Extract<MenuItem, { kind: "mcp-server" }>["server"];
}) {
  const { t } = useLingui();
  const { title } = server;
  return (
    <Labelled
      hint={t`This chat`}
      label={server.enabled ? t`Turn off ${title}` : t`Turn on ${title}`}
    />
  );
}

function UploadText() {
  const { t } = useLingui();
  return <Labelled label={t`Upload a file`} />;
}

function SuggestionText({ item }: { readonly item: MenuItem }) {
  switch (item.kind) {
    case "agent":
      return (
        <Labelled
          draft={item.agent.draftVersion !== undefined}
          hint={item.agent.description || undefined}
          label={item.agent.name}
        />
      );
    case "artifact":
      return <Labelled label={item.artifact.label} />;
    case "command":
      return <CommandText command={item.command} />;
    case "mcp-server":
      return <ServerText server={item.server} />;
    case "open-file":
      return <Labelled hint={item.file.description} label={item.file.label} />;
    case "mention":
      return (
        <Labelled
          hint={item.candidate.description}
          label={item.candidate.label}
        />
      );
    case "prompt": {
      const { command } = item.prompt.definition;
      return (
        <Labelled
          draft={item.prompt.draftVersion !== undefined}
          hint={command ? `/${command}` : undefined}
          label={item.prompt.name}
          mono
        />
      );
    }
    case "skill":
      return (
        <Labelled
          draft={item.skill.draftVersion !== undefined}
          hint={item.skill.description || undefined}
          label={item.skill.name}
        />
      );
    case "upload":
      return <UploadText />;
    default:
      return item satisfies never;
  }
}

interface SuggestionOptionProps {
  readonly active: boolean;
  readonly id: string;
  readonly index: number;
  readonly onChoose: (index: number) => void;
  readonly onHover: (index: number) => void;
  readonly suggestion: MenuItem;
}

function SuggestionOption({
  active,
  id,
  index,
  onChoose,
  onHover,
  suggestion,
}: SuggestionOptionProps) {
  const handleClick = useCallback(() => onChoose(index), [index, onChoose]);
  const handleMouseMove = useCallback(() => onHover(index), [index, onHover]);
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the textarea handles this listbox's keys (see keepFocus).
    <div
      aria-selected={active}
      className={cn(
        "flex cursor-default select-none items-center gap-2 rounded-md px-1.5 py-1 text-sm [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground",
        active && "bg-accent text-accent-foreground"
      )}
      id={id}
      onClick={handleClick}
      onMouseDown={keepFocus}
      onMouseMove={handleMouseMove}
      role="option"
      // Focusable in principle, as the role requires, but never tabbed to.
      tabIndex={-1}
    >
      <SuggestionIcon item={suggestion} />
      <SuggestionText item={suggestion} />
    </div>
  );
}

interface Section {
  readonly entries: readonly MenuItem[];
  readonly group: MenuGroup;
  /** The first entry's index in the whole list. */
  readonly start: number;
}

/** Runs of items in the same group, in list order. Pure. */
export const sections = (items: readonly MenuItem[]): readonly Section[] => {
  const runs: { entries: MenuItem[]; group: MenuGroup; start: number }[] = [];
  items.forEach((item, index) => {
    const group = menuGroup(item);
    const last = runs.at(-1);
    if (last?.group === group) {
      last.entries.push(item);
    } else {
      runs.push({ entries: [item], group, start: index });
    }
  });
  return runs;
};

function GroupHeading({
  group,
  id,
  mcpLabel,
}: {
  readonly group: MenuGroup;
  readonly id: string;
  readonly mcpLabel: string;
}) {
  const { t } = useLingui();
  const titles: Record<MenuGroup, string> = {
    agents: t`Agents`,
    commands: t`Commands`,
    files: t`Files`,
    make: t`Make`,
    mcp: mcpLabel,
    people: t`People`,
    prompts: t`Prompts`,
    skills: t`Skills`,
    upload: t`Add`,
  };
  return (
    <div
      className="px-1.5 pt-1.5 pb-0.5 font-medium text-muted-foreground text-xs"
      id={id}
      role="presentation"
    >
      {titles[group]}
    </div>
  );
}

export function SuggestionMenu({
  activeIndex,
  id,
  items,
  mcpLabel,
  onChoose,
  onHover,
}: SuggestionMenuProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const { t } = useLingui();

  // Arrowing past the visible options scrolls the next one into view.
  useEffect(() => {
    listRef.current
      ?.querySelector(`#${CSS.escape(optionId(id, activeIndex))}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, id]);

  return (
    <div
      className="absolute inset-x-0 bottom-full z-50 mb-2 flex max-h-80 flex-col overflow-hidden rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10"
      data-slot="composer-suggestions"
    >
      <div
        aria-label={t`Suggestions`}
        className="overflow-y-auto"
        id={id}
        ref={listRef}
        role="listbox"
      >
        {sections(items).map(({ group, start, entries }) => {
          const headingId = `${id}-group-${group}`;
          return (
            // biome-ignore lint/a11y/useSemanticElements: ARIA's grouped listbox; a fieldset is for form controls, not options.
            <div aria-labelledby={headingId} key={group} role="group">
              <GroupHeading group={group} id={headingId} mcpLabel={mcpLabel} />
              {entries.map((suggestion, offset) => (
                <SuggestionOption
                  active={start + offset === activeIndex}
                  id={optionId(id, start + offset)}
                  index={start + offset}
                  key={suggestionKey(suggestion)}
                  onChoose={onChoose}
                  onHover={onHover}
                  suggestion={suggestion}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
