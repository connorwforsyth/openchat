"use client";

import { useLingui } from "@lingui/react/macro";
import type { LibraryKind } from "@workspace/contract/schemas/library";
import {
  AgentIcon,
  FileTextIcon,
  type Icon,
  SettingsIcon,
  SparklesIcon,
  ToolIcon,
} from "@workspace/icons";
import { cn } from "@workspace/ui/lib/utils";

// How each kind of library item is drawn and named.

const ICONS: Record<LibraryKind, Icon> = {
  agent: AgentIcon,
  mcp_server: ToolIcon,
  preset: SettingsIcon,
  prompt: FileTextIcon,
  skill: SparklesIcon,
};

export const useKindLabels = (): Record<LibraryKind, string> => {
  const { t } = useLingui();
  return {
    agent: t`Agent`,
    mcp_server: t`MCP server`,
    preset: t`Preset`,
    prompt: t`Prompt`,
    skill: t`Skill`,
  };
};

export const useKindPlurals = (): Record<LibraryKind, string> => {
  const { t } = useLingui();
  return {
    agent: t`Agents`,
    mcp_server: t`MCP servers`,
    preset: t`Presets`,
    prompt: t`Prompts`,
    skill: t`Skills`,
  };
};

/** The kind's glyph in a muted tile, as the library cards and builder header show it. */
export function KindTile({
  className,
  kind,
}: {
  readonly className?: string;
  readonly kind: LibraryKind;
}) {
  const Glyph = ICONS[kind];
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground",
        className
      )}
    >
      <Glyph className="size-4" />
    </span>
  );
}
