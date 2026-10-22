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
import { candidateKey } from "../mentions";
import type { SlashItem } from "../options";
import type { ComposerCommand, MentionCandidate } from "../schemas";
import { MenuLabel, MenuListbox } from "./menu-listbox";

export type Suggestion =
  | SlashItem
  | { readonly kind: "mention"; readonly candidate: MentionCandidate };

export const suggestionKey = (suggestion: Suggestion): string => {
  switch (suggestion.kind) {
    case "command":
      return `command:${suggestion.command}`;
    case "mcp-server":
      return `mcp:${suggestion.server.id}`;
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

export interface SuggestionMenuProps {
  readonly activeIndex: number;
  readonly id: string;
  readonly items: readonly Suggestion[];
  readonly onChoose: (index: number) => void;
  readonly onHover: (index: number) => void;
  readonly title: string;
}

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
    case "mcp-server":
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

function CommandText({ command }: { readonly command: ComposerCommand }) {
  const { t } = useLingui();
  const labels: Record<ComposerCommand, string> = {
    "new-file": t`New file`,
    open: t`Open file`,
    preview: t`Preview`,
  };
  return <MenuLabel hint={`/${command}`} label={labels[command]} mono />;
}

/** "Turn off Company docs", with "This chat" as the hint: it's a switch, not a mention. */
function ServerText({
  server,
}: {
  readonly server: Extract<Suggestion, { kind: "mcp-server" }>["server"];
}) {
  const { t } = useLingui();
  const { title } = server;
  return (
    <MenuLabel
      hint={t`This chat`}
      label={server.enabled ? t`Turn off ${title}` : t`Turn on ${title}`}
    />
  );
}

function SuggestionText({ suggestion }: { readonly suggestion: Suggestion }) {
  switch (suggestion.kind) {
    case "command":
      return <CommandText command={suggestion.command} />;
    case "mcp-server":
      return <ServerText server={suggestion.server} />;
    case "file":
      return (
        <MenuLabel
          hint={suggestion.file.description}
          label={suggestion.file.label}
        />
      );
    case "mention":
      return (
        <MenuLabel
          hint={suggestion.candidate.description}
          label={suggestion.candidate.label}
        />
      );
    case "prompt": {
      const { command } = suggestion.prompt.definition;
      return (
        <MenuLabel
          hint={command ? `/${command}` : undefined}
          label={suggestion.prompt.name}
          mono
        />
      );
    }
    case "skill":
      return (
        <MenuLabel
          hint={suggestion.skill.description || undefined}
          label={suggestion.skill.name}
        />
      );
    default:
      return suggestion satisfies never;
  }
}

const renderSuggestion = (suggestion: Suggestion) => (
  <>
    <SuggestionIcon suggestion={suggestion} />
    <SuggestionText suggestion={suggestion} />
  </>
);

export function SuggestionMenu({
  activeIndex,
  id,
  items,
  onChoose,
  onHover,
  title,
}: SuggestionMenuProps) {
  return (
    <MenuListbox
      activeIndex={activeIndex}
      className="absolute inset-x-0 bottom-full mb-2"
      id={id}
      itemKey={suggestionKey}
      items={items}
      onChoose={onChoose}
      onHover={onHover}
      renderItem={renderSuggestion}
      slot="composer-suggestions"
      title={title}
    />
  );
}
