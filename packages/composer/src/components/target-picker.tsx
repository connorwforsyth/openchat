"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import type { ModelOption } from "@workspace/contract/schemas/models";
import type { RunTarget } from "@workspace/contract/schemas/runs";
import { AgentIcon, ChevronDownIcon, SparklesIcon } from "@workspace/icons";
import { PromptInputButton } from "@workspace/ui/components/ai-elements/prompt-input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { useCallback, useMemo } from "react";

import {
  AUTO_TARGET,
  buildTargetGroups,
  findTargetChoice,
  isAutoTarget,
  type TargetChoice,
  targetKey,
} from "../options";
import type { AgentOption, AgentSource } from "../schemas";

export interface TargetPickerProps {
  readonly agents: readonly AgentOption[];
  readonly disabled?: boolean;
  readonly models: readonly ModelOption[];
  readonly onChange: (target: RunTarget) => void;
  readonly value: RunTarget;
}

function ChoiceItems({
  choices,
}: {
  readonly choices: readonly TargetChoice[];
}) {
  return choices.map((choice) => (
    <DropdownMenuRadioItem
      closeOnClick
      disabled={!choice.available}
      key={choice.key}
      value={choice.key}
    >
      {choice.target.type === "agent" ? <AgentIcon aria-hidden /> : null}
      <span className="truncate">{choice.label}</span>
    </DropdownMenuRadioItem>
  ));
}

function AgentGroupLabel({ source }: { readonly source: AgentSource | null }) {
  switch (source) {
    case "mine":
      return <Trans>My agents</Trans>;
    case "shared":
      return <Trans>Shared with me</Trans>;
    case "libraries":
      return <Trans>Team & org agents</Trans>;
    case null:
      return <Trans>Agents</Trans>;
    default:
      return source satisfies never;
  }
}

/** Auto, an agent, or a model (D3, D15): what answers the next turn. */
export function TargetPicker({
  agents,
  disabled,
  models,
  onChange,
  value,
}: TargetPickerProps) {
  const { t } = useLingui();
  const groups = useMemo(
    () => buildTargetGroups(models, agents),
    [agents, models]
  );

  const current = findTargetChoice(groups, value);
  // A target the list doesn't offer (an agent shared then revoked, a model
  // since removed) still shows what it is rather than a blank button.
  const fallback = value.type === "agent" ? t`Unknown agent` : value.model;
  const label = isAutoTarget(value) ? t`Auto` : (current?.label ?? fallback);

  const handleValueChange = useCallback(
    (key: unknown) => {
      if (key === targetKey(AUTO_TARGET)) {
        onChange(AUTO_TARGET);
        return;
      }
      const choice = [
        ...groups.agents,
        ...groups.providers.flatMap((group) => group.choices),
      ].find((candidate) => candidate.key === key);
      if (choice) {
        onChange(choice.target);
      }
    },
    [groups, onChange]
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        render={
          <PromptInputButton
            aria-label={t`Model or agent: ${label}`}
            className="max-w-48"
            size="sm"
          />
        }
      >
        {value.type === "agent" ? (
          <AgentIcon aria-hidden />
        ) : (
          <SparklesIcon aria-hidden />
        )}
        <span className="truncate">{label}</span>
        <ChevronDownIcon aria-hidden className="size-3.5 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-64">
        <DropdownMenuRadioGroup
          onValueChange={handleValueChange}
          value={targetKey(value)}
        >
          <DropdownMenuRadioItem
            closeOnClick
            disabled={!groups.autoAvailable}
            value={targetKey(AUTO_TARGET)}
          >
            <SparklesIcon aria-hidden />
            <span className="flex flex-col">
              <Trans>Auto</Trans>
              <span className="text-muted-foreground text-xs">
                <Trans>Picks a model for each message</Trans>
              </span>
            </span>
          </DropdownMenuRadioItem>
          {groups.agentGroups.map((group) => (
            <DropdownMenuGroup key={group.source ?? "agents"}>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>
                <AgentGroupLabel source={group.source} />
              </DropdownMenuLabel>
              <ChoiceItems choices={group.choices} />
            </DropdownMenuGroup>
          ))}
          {groups.providers.map((group) => (
            <DropdownMenuGroup key={group.provider}>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>
                {group.provider === "" ? <Trans>Models</Trans> : group.provider}
              </DropdownMenuLabel>
              <ChoiceItems choices={group.choices} />
            </DropdownMenuGroup>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
