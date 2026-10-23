"use client";

import { useLingui } from "@lingui/react/macro";
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

import { candidateKey } from "../mentions";
import type { MenuItem } from "../options";
import type { ComposerCommand } from "../schemas";
import { ARTIFACT_ICONS } from "./chip";
import { MenuLabel, MenuListbox } from "./menu-listbox";

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

export interface SuggestionMenuProps {
  readonly activeIndex: number;
  readonly id: string;
  readonly items: readonly MenuItem[];
  /** What this instance calls MCP servers (191), for their section. */
  readonly mcpLabel: string;
  readonly onChoose: (index: number) => void;
  readonly onHover: (index: number) => void;
}

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
  readonly server: Extract<MenuItem, { kind: "mcp-server" }>["server"];
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

function UploadText() {
  const { t } = useLingui();
  return <MenuLabel label={t`Upload a file`} />;
}

function SuggestionText({ item }: { readonly item: MenuItem }) {
  switch (item.kind) {
    case "agent":
      return (
        <MenuLabel
          draft={item.agent.draftVersion !== undefined}
          hint={item.agent.description || undefined}
          label={item.agent.name}
        />
      );
    case "artifact":
      return <MenuLabel label={item.artifact.label} />;
    case "command":
      return <CommandText command={item.command} />;
    case "mcp-server":
      return <ServerText server={item.server} />;
    case "open-file":
      return <MenuLabel hint={item.file.description} label={item.file.label} />;
    case "mention":
      return (
        <MenuLabel
          hint={item.candidate.description}
          label={item.candidate.label}
        />
      );
    case "prompt": {
      const { command } = item.prompt.definition;
      return (
        <MenuLabel
          draft={item.prompt.draftVersion !== undefined}
          hint={command ? `/${command}` : undefined}
          label={item.prompt.name}
          mono
        />
      );
    }
    case "skill":
      return (
        <MenuLabel
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

const renderItem = (item: MenuItem) => (
  <>
    <SuggestionIcon item={item} />
    <SuggestionText item={item} />
  </>
);

export function SuggestionMenu({
  activeIndex,
  id,
  items,
  mcpLabel,
  onChoose,
  onHover,
}: SuggestionMenuProps) {
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
    <MenuListbox
      activeIndex={activeIndex}
      className="absolute inset-x-0 bottom-full mb-2 max-h-80"
      groups={{
        of: menuGroup,
        title: (group) => titles[group as MenuGroup],
      }}
      id={id}
      itemKey={suggestionKey}
      items={items}
      onChoose={onChoose}
      onHover={onHover}
      renderItem={renderItem}
      slot="composer-suggestions"
      title={t`Suggestions`}
    />
  );
}
