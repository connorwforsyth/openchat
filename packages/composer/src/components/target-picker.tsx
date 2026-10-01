"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import type { ModelOption } from "@workspace/contract/schemas/models";
import type { RunTarget } from "@workspace/contract/schemas/runs";
import { AgentIcon, ChevronDownIcon, SparklesIcon } from "@workspace/icons";
import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorEmpty,
  ModelSelectorGroup,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorLogo,
  ModelSelectorName,
  ModelSelectorSeparator,
  ModelSelectorTrigger,
} from "@workspace/ui/components/ai-elements/model-selector";
import { PromptInputButton } from "@workspace/ui/components/ai-elements/prompt-input";
import {
  Fragment,
  type ReactNode,
  useCallback,
  useMemo,
  useState,
} from "react";

import {
  AUTO_TARGET,
  buildTargetGroups,
  filterTargetGroups,
  findTargetChoice,
  isAutoTarget,
  modelVendor,
  providerLabel,
  type TargetChoice,
  type TargetGroups,
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

const AUTO_KEY = targetKey(AUTO_TARGET);

const findTargetByKey = (
  groups: TargetGroups,
  key: string
): RunTarget | undefined =>
  [
    ...groups.providers.flatMap((group) => group.choices),
    ...groups.agents,
  ].find((choice) => choice.key === key)?.target;

function Unavailable() {
  return (
    <span className="text-muted-foreground text-xs">
      <Trans>No key in this context</Trans>
    </span>
  );
}

function ChoiceRow({
  choice,
  current,
  icon,
  onChoose,
}: {
  readonly choice: TargetChoice;
  readonly current: string;
  readonly icon: ReactNode;
  /** Called with the row's key (cmdk hands `onSelect` the item's value). */
  readonly onChoose: (key: string) => void;
}) {
  return (
    <ModelSelectorItem
      data-checked={choice.key === current}
      disabled={!choice.available}
      onSelect={onChoose}
      value={choice.key}
    >
      <span className="mt-0.5 flex shrink-0">{icon}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-baseline gap-2">
          <ModelSelectorName className="flex-none shrink">
            {choice.label}
          </ModelSelectorName>
          {choice.detail ? (
            <span className="min-w-0 truncate text-muted-foreground text-xs">
              {choice.detail}
            </span>
          ) : null}
        </span>
        {choice.description ? (
          <span className="text-muted-foreground text-xs">
            {choice.description}
          </span>
        ) : null}
        {choice.available ? null : <Unavailable />}
      </span>
    </ModelSelectorItem>
  );
}

function useAgentGroupLabel() {
  const { t } = useLingui();
  return (source: AgentSource | null): string => {
    switch (source) {
      case "mine":
        return t`My agents`;
      case "shared":
        return t`Shared with me`;
      case "libraries":
        return t`Team & org agents`;
      case null:
        return t`Agents`;
      default:
        return source satisfies never;
    }
  };
}

interface Section {
  readonly key: string;
  readonly node: ReactNode;
}

/**
 * Auto, a model or an agent (D3, D15): what answers the next turn. A search
 * dialog over every option (AI Elements' model selector), in sections with
 * a divider between them: Auto, each provider's models, then agents by
 * where they come from. Escape closes it and focus goes back to the button.
 */
export function TargetPicker({
  agents,
  disabled,
  models,
  onChange,
  value,
}: TargetPickerProps) {
  const { t } = useLingui();
  const agentGroupLabel = useAgentGroupLabel();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState("");
  const groups = useMemo(
    () => buildTargetGroups(models, agents),
    [agents, models]
  );

  const current = findTargetChoice(groups, value);
  const currentKey = targetKey(value);
  // A target the list doesn't offer (an agent shared then revoked, a model
  // since removed) still shows what it is rather than a blank button.
  const fallback = value.type === "agent" ? t`Unknown agent` : value.model;
  const autoLabel = t`Auto`;
  const autoDescription = t`Picks a fast or strong model for each message`;
  const label = isAutoTarget(value) ? autoLabel : (current?.label ?? fallback);

  const shown = useMemo(
    () => filterTargetGroups(groups, query, `${autoLabel} ${autoDescription}`),
    [autoDescription, autoLabel, groups, query]
  );

  const choose = useCallback(
    (key: string) => {
      const target =
        key === AUTO_KEY ? AUTO_TARGET : findTargetByKey(groups, key);
      setOpen(false);
      if (target) {
        onChange(target);
      }
    },
    [groups, onChange]
  );

  const handleOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (next) {
        // Each opening starts from the whole list, on the current choice.
        setQuery("");
        setHighlighted(currentKey);
      }
    },
    [currentKey]
  );

  const sections: Section[] = [];
  if (shown.auto) {
    sections.push({
      key: "auto",
      node: (
        <ModelSelectorGroup>
          <ModelSelectorItem
            data-checked={currentKey === AUTO_KEY}
            disabled={!groups.autoAvailable}
            onSelect={choose}
            value={AUTO_KEY}
          >
            <SparklesIcon aria-hidden className="mt-0.5" />
            <span className="flex min-w-0 flex-1 flex-col">
              <ModelSelectorName>{autoLabel}</ModelSelectorName>
              <span className="text-muted-foreground text-xs">
                {autoDescription}
              </span>
              {groups.autoAvailable ? null : <Unavailable />}
            </span>
          </ModelSelectorItem>
        </ModelSelectorGroup>
      ),
    });
  }
  for (const group of shown.providers) {
    const heading = group.provider === "" ? t`Models` : group.label;
    sections.push({
      key: `provider:${group.provider}`,
      node: (
        <ModelSelectorGroup heading={heading}>
          {group.choices.map((choice) => (
            <ChoiceRow
              choice={choice}
              current={currentKey}
              icon={<ModelSelectorLogo provider={heading} />}
              key={choice.key}
              onChoose={choose}
            />
          ))}
        </ModelSelectorGroup>
      ),
    });
  }
  for (const group of shown.agentGroups) {
    sections.push({
      key: `agents:${group.source ?? ""}`,
      node: (
        <ModelSelectorGroup heading={agentGroupLabel(group.source)}>
          {group.choices.map((choice) => (
            <ChoiceRow
              choice={choice}
              current={currentKey}
              icon={<AgentIcon aria-hidden />}
              key={choice.key}
              onChoose={choose}
            />
          ))}
        </ModelSelectorGroup>
      ),
    });
  }

  const currentModel =
    value.type === "model" && !isAutoTarget(value)
      ? models.find((model) => model.selector === value.model)
      : undefined;
  let triggerIcon: ReactNode = <SparklesIcon aria-hidden />;
  if (value.type === "agent") {
    triggerIcon = <AgentIcon aria-hidden />;
  } else if (currentModel) {
    triggerIcon = (
      <ModelSelectorLogo
        provider={providerLabel(modelVendor(currentModel)) || label}
      />
    );
  }

  return (
    <ModelSelector onOpenChange={handleOpenChange} open={open}>
      <ModelSelectorTrigger
        disabled={disabled}
        render={
          <PromptInputButton
            aria-label={t`Model or agent: ${label}`}
            className="max-w-48 rounded-full text-muted-foreground hover:text-foreground aria-expanded:text-foreground"
            size="sm"
          />
        }
      >
        {triggerIcon}
        <span className="truncate">{label}</span>
        <ChevronDownIcon aria-hidden className="size-3.5 opacity-60" />
      </ModelSelectorTrigger>
      <ModelSelectorContent
        command={{
          label: t`Models and agents`,
          loop: true,
          onValueChange: setHighlighted,
          shouldFilter: false,
          value: highlighted,
        }}
        title={t`Choose a model or agent`}
      >
        <ModelSelectorInput
          onValueChange={setQuery}
          placeholder={t`Search models and agents`}
          value={query}
        />
        <ModelSelectorList>
          <ModelSelectorEmpty>
            <Trans>Nothing matches.</Trans>
          </ModelSelectorEmpty>
          {sections.map((section, index) => (
            <Fragment key={section.key}>
              {index > 0 ? <ModelSelectorSeparator /> : null}
              {section.node}
            </Fragment>
          ))}
        </ModelSelectorList>
      </ModelSelectorContent>
    </ModelSelector>
  );
}
