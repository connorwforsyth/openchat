"use client";

import { useLingui } from "@lingui/react/macro";
import {
  AgentIcon,
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
import type { SlashItem } from "../options";
import type { ComposerCommand, MentionCandidate } from "../schemas";

export type Suggestion =
  | SlashItem
  | { readonly kind: "mention"; readonly candidate: MentionCandidate };

export const suggestionKey = (suggestion: Suggestion): string => {
  switch (suggestion.kind) {
    case "command":
      return `command:${suggestion.command}`;
    case "connector":
      return `connector:${suggestion.connector.id}`;
    case "file":
      return `file:${suggestion.file.path}`;
    case "mention":
      return candidateKey(suggestion.candidate);
    case "prompt":
      return `prompt:${suggestion.prompt.id}`;
    case "skill":
      return `skill:${suggestion.skill.id}`;
    default:
      return suggestion satisfies never;
  }
};

export const optionId = (listboxId: string, index: number) =>
  `${listboxId}-option-${index}`;

export interface SuggestionMenuProps {
  readonly activeIndex: number;
  readonly id: string;
  readonly items: readonly Suggestion[];
  readonly onChoose: (index: number) => void;
  readonly onHover: (index: number) => void;
  readonly title: string;
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

function SuggestionIcon({ suggestion }: { readonly suggestion: Suggestion }) {
  switch (suggestion.kind) {
    case "command": {
      const Icon = COMMAND_ICONS[suggestion.command];
      return <Icon aria-hidden />;
    }
    case "connector":
      return <NetworkIcon aria-hidden />;
    case "file":
      return <FileIcon aria-hidden />;
    case "mention":
      if (suggestion.candidate.kind === "file") {
        return <FileIcon aria-hidden />;
      }
      return suggestion.candidate.kind === "agent" ? (
        <AgentIcon aria-hidden />
      ) : (
        <UserIcon aria-hidden />
      );
    case "prompt":
      return <FileTextIcon aria-hidden />;
    case "skill":
      return <SparklesIcon aria-hidden />;
    default:
      return suggestion satisfies never;
  }
}

/** A name, with a quieter hint at the far end (a command, an email, a folder). */
function Labelled({
  hint,
  label,
  mono = false,
}: {
  readonly hint?: string;
  readonly label: string;
  readonly mono?: boolean;
}) {
  return (
    <>
      <span className="truncate">{label}</span>
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
function ConnectorText({
  connector,
}: {
  readonly connector: Extract<Suggestion, { kind: "connector" }>["connector"];
}) {
  const { t } = useLingui();
  const { title } = connector;
  return (
    <Labelled
      hint={t`This chat`}
      label={connector.enabled ? t`Turn off ${title}` : t`Turn on ${title}`}
    />
  );
}

function SuggestionText({ suggestion }: { readonly suggestion: Suggestion }) {
  switch (suggestion.kind) {
    case "command":
      return <CommandText command={suggestion.command} />;
    case "connector":
      return <ConnectorText connector={suggestion.connector} />;
    case "file":
      return (
        <Labelled
          hint={suggestion.file.description}
          label={suggestion.file.label}
        />
      );
    case "mention":
      return (
        <Labelled
          hint={suggestion.candidate.description}
          label={suggestion.candidate.label}
        />
      );
    case "prompt": {
      const { command } = suggestion.prompt.definition;
      return (
        <Labelled
          hint={command ? `/${command}` : undefined}
          label={suggestion.prompt.name}
          mono
        />
      );
    }
    case "skill":
      return (
        <Labelled
          hint={suggestion.skill.description || undefined}
          label={suggestion.skill.name}
        />
      );
    default:
      return suggestion satisfies never;
  }
}

interface SuggestionOptionProps {
  readonly active: boolean;
  readonly id: string;
  readonly index: number;
  readonly onChoose: (index: number) => void;
  readonly onHover: (index: number) => void;
  readonly suggestion: Suggestion;
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
      <SuggestionIcon suggestion={suggestion} />
      <SuggestionText suggestion={suggestion} />
    </div>
  );
}

export function SuggestionMenu({
  activeIndex,
  id,
  items,
  onChoose,
  onHover,
  title,
}: SuggestionMenuProps) {
  const listRef = useRef<HTMLDivElement>(null);

  // Arrowing past the visible options scrolls the next one into view.
  useEffect(() => {
    listRef.current
      ?.querySelector(`#${CSS.escape(optionId(id, activeIndex))}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, id]);

  const titleId = `${id}-title`;

  return (
    <div
      className="absolute inset-x-0 bottom-full z-50 mb-2 flex max-h-72 flex-col overflow-hidden rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10"
      data-slot="composer-suggestions"
    >
      <p
        className="px-1.5 py-1 font-medium text-muted-foreground text-xs"
        id={titleId}
      >
        {title}
      </p>
      <div
        aria-labelledby={titleId}
        className="overflow-y-auto"
        id={id}
        ref={listRef}
        role="listbox"
      >
        {items.map((suggestion, index) => (
          <SuggestionOption
            active={index === activeIndex}
            id={optionId(id, index)}
            index={index}
            key={suggestionKey(suggestion)}
            onChoose={onChoose}
            onHover={onHover}
            suggestion={suggestion}
          />
        ))}
      </div>
    </div>
  );
}
