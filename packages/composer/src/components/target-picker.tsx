"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import type { ModelOption } from "@workspace/contract/schemas/models";
import type { RunTarget } from "@workspace/contract/schemas/runs";
import {
  AgentIcon,
  ChevronDownIcon,
  EyeIcon,
  ReasoningIcon,
  SparklesIcon,
  ToolIcon,
} from "@workspace/icons";
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
  ModelSelectorPreviewMeter,
  ModelSelectorPreviewNote,
  ModelSelectorPreviewRow,
  ModelSelectorPreviewSection,
  ModelSelectorPreviewTitle,
  ModelSelectorSeparator,
  ModelSelectorTrigger,
  ModelSelectorVendor,
} from "@workspace/ui/components/ai-elements/model-selector";
import { PromptInputButton } from "@workspace/ui/components/ai-elements/prompt-input";
import {
  Fragment,
  type ReactNode,
  useCallback,
  useMemo,
  useState,
} from "react";

import { useRecentTargets } from "../hooks/use-recent-targets";
import {
  AUTO_TARGET,
  buildTargetGroups,
  contextSize,
  filterTargetGroups,
  findTargetChoice,
  isAutoTarget,
  listedTarget,
  modelVendor,
  providerLabel,
  recentChoices,
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
  /**
   * Whose "Recently used" this is, like the signed-in user's id: picks are
   * remembered in local storage under it. Left out, they're shared by
   * whoever uses this browser.
   */
  readonly recentsKey?: string;
  readonly value: RunTarget;
}

const AUTO_KEY = targetKey(AUTO_TARGET);
// A recent row repeats a row further down; cmdk needs each value unique.
const RECENT_PREFIX = "recent:";

const keyOfValue = (value: string): string =>
  value.startsWith(RECENT_PREFIX) ? value.slice(RECENT_PREFIX.length) : value;

const findChoiceByKey = (
  groups: TargetGroups,
  key: string
): TargetChoice | undefined =>
  [
    ...groups.providers.flatMap((group) => group.choices),
    ...groups.agents,
  ].find((choice) => choice.key === key);

function Unavailable() {
  return (
    <span className="text-muted-foreground text-xs">
      <Trans>No key in this context</Trans>
    </span>
  );
}

function ChoiceIcon({ choice }: { readonly choice: TargetChoice }) {
  if (choice.target.type === "agent") {
    return <AgentIcon aria-hidden className="size-4" />;
  }
  return (
    <ModelSelectorLogo
      name={providerLabel(choice.vendor ?? "")}
      provider={choice.vendor ?? ""}
    />
  );
}

function ChoiceRow({
  choice,
  current,
  onChoose,
  value,
}: {
  readonly choice: TargetChoice;
  readonly current: string;
  /** Called with the row's value (cmdk hands `onSelect` the item's value). */
  readonly onChoose: (value: string) => void;
  readonly value: string;
}) {
  const vendor =
    choice.target.type === "model" && choice.vendor
      ? providerLabel(choice.vendor)
      : undefined;
  return (
    <ModelSelectorItem
      aria-current={choice.key === current ? "true" : undefined}
      disabled={!choice.available}
      onSelect={onChoose}
      value={value}
    >
      <span className="mt-0.5 flex shrink-0">
        <ChoiceIcon choice={choice} />
      </span>
      {/* One line, one size: the card says the rest (105). */}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-baseline gap-2">
          <ModelSelectorName className="flex-none shrink">
            {choice.label}
          </ModelSelectorName>
          {choice.detail ? (
            <span className="min-w-0 truncate text-muted-foreground">
              {choice.detail}
            </span>
          ) : null}
        </span>
        {choice.available ? null : <Unavailable />}
      </span>
      {vendor ? <ModelSelectorVendor>{vendor}</ModelSelectorVendor> : null}
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

function Capabilities({ model }: { readonly model: ModelOption }) {
  const can = new Set(model.capabilities);
  // Only what the server says the model does. "Unsupported" would need the
  // server to say so too; absence here can just mean nobody said.
  if (!(can.has("vision") || can.has("tools") || can.has("reasoning"))) {
    return null;
  }
  return (
    <ModelSelectorPreviewSection>
      {can.has("vision") ? (
        <ModelSelectorPreviewRow icon={<EyeIcon aria-hidden />}>
          <Trans>Vision</Trans>
        </ModelSelectorPreviewRow>
      ) : null}
      {can.has("tools") ? (
        <ModelSelectorPreviewRow icon={<ToolIcon aria-hidden />}>
          <Trans>Tool use</Trans>
        </ModelSelectorPreviewRow>
      ) : null}
      {can.has("reasoning") ? (
        <ModelSelectorPreviewRow icon={<ReasoningIcon aria-hidden />}>
          <Trans>Reasoning</Trans>
        </ModelSelectorPreviewRow>
      ) : null}
    </ModelSelectorPreviewSection>
  );
}

function ModelPreview({
  choice,
  model,
}: {
  readonly choice: TargetChoice;
  readonly model: ModelOption;
}) {
  const { i18n, t } = useLingui();
  // An alias's card is about the model behind it.
  const name = choice.detail ?? choice.label;
  const { cost, ratings } = model;
  const meters = [
    ratings?.speed === undefined
      ? null
      : { label: t`Speed`, value: ratings.speed },
    ratings?.intelligence === undefined
      ? null
      : { label: t`Intelligence`, value: ratings.intelligence },
    cost === undefined ? null : { label: t`Cost`, value: cost.tier },
  ].filter((meter) => meter !== null);
  const size =
    model.contextWindow === null
      ? undefined
      : contextSize(model.contextWindow, i18n.locale);
  return (
    <>
      <ModelSelectorPreviewTitle icon={<ChoiceIcon choice={choice} />}>
        {name}
      </ModelSelectorPreviewTitle>
      {meters.length > 0 ? (
        <ModelSelectorPreviewSection className="gap-2">
          {meters.map((meter) => (
            <ModelSelectorPreviewMeter
              key={meter.label}
              label={meter.label}
              value={meter.value}
              valueText={t`${meter.value} of 5`}
            />
          ))}
        </ModelSelectorPreviewSection>
      ) : (
        <ModelSelectorPreviewNote className="rounded-md bg-muted px-2 py-3 text-center">
          <Trans>No ratings or prices for {name}</Trans>
        </ModelSelectorPreviewNote>
      )}
      {size ? (
        <ModelSelectorPreviewRow data-testid="model-preview-context">
          <span className="text-muted-foreground">
            <Trans>Context</Trans>
          </span>
          <span className="ms-auto flex items-baseline gap-1.5 whitespace-nowrap tabular-nums">
            <span className="text-muted-foreground">
              <Trans>~{size.words} words</Trans>
            </span>
            <span aria-hidden className="text-border">
              |
            </span>
            <span className="font-medium">
              <Trans>{size.tokens} tokens</Trans>
            </span>
          </span>
        </ModelSelectorPreviewRow>
      ) : null}
      <Capabilities model={model} />
      {choice.description ? (
        <ModelSelectorPreviewNote>
          {choice.description}
        </ModelSelectorPreviewNote>
      ) : null}
      {choice.available ? null : (
        <ModelSelectorPreviewNote>
          <Trans>No key in this context</Trans>
        </ModelSelectorPreviewNote>
      )}
    </>
  );
}

function ChoicePreview({ choice }: { readonly choice: TargetChoice }) {
  if (choice.model) {
    return <ModelPreview choice={choice} model={choice.model} />;
  }
  const description = choice.agent?.description?.trim();
  return (
    <>
      <ModelSelectorPreviewTitle icon={<ChoiceIcon choice={choice} />}>
        {choice.label}
      </ModelSelectorPreviewTitle>
      {description ? (
        <ModelSelectorPreviewNote>{description}</ModelSelectorPreviewNote>
      ) : null}
    </>
  );
}

interface Section {
  readonly key: string;
  readonly node: ReactNode;
}

/**
 * Auto, a model or an agent (D3, D15): what answers the next turn. An
 * overlay (AI Elements' model selector on a dialog, 105) with a search over
 * every option, in sections with a divider between them: Recently used,
 * Auto, each provider's models, then agents by where they come from. Each
 * row is one line: the vendor's logo, the model's own name and the vendor
 * at its end. A card beside the list says more about whichever row is
 * highlighted, by arrow key or pointer (099). Entries that are only a mode
 * of a model are folded into it; the thinking control and fast mode pick
 * them (105). Escape closes it and focus goes back to the button.
 */
export function TargetPicker({
  agents,
  disabled,
  models,
  onChange,
  recentsKey,
  value,
}: TargetPickerProps) {
  const { t } = useLingui();
  const agentGroupLabel = useAgentGroupLabel();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState("");
  const [recentKeys, rememberRecent] = useRecentTargets(recentsKey);
  const groups = useMemo(
    () => buildTargetGroups(models, agents),
    [agents, models]
  );
  const recents = useMemo(
    () => recentChoices(groups, recentKeys),
    [groups, recentKeys]
  );

  const current = findTargetChoice(groups, value);
  // A folded entry (`o4-mini-high`) checks its model's row (105).
  const currentKey = targetKey(listedTarget(groups, value));
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
  const showRecents = query.trim() === "" && recents.length > 0;

  const choose = useCallback(
    (chosen: string) => {
      const key = keyOfValue(chosen);
      const target =
        key === AUTO_KEY ? AUTO_TARGET : findChoiceByKey(groups, key)?.target;
      setOpen(false);
      if (target) {
        if (key !== AUTO_KEY) {
          rememberRecent(key);
        }
        onChange(target);
      }
    },
    [groups, onChange, rememberRecent]
  );

  const handleOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (next) {
        // Each opening starts from the whole list, on the current choice:
        // its recent row when it has one, so it's in view at the top.
        setQuery("");
        setHighlighted(
          recents.some((choice) => choice.key === currentKey)
            ? `${RECENT_PREFIX}${currentKey}`
            : currentKey
        );
      }
    },
    [currentKey, recents]
  );

  const preview = useCallback(
    (active: string): ReactNode => {
      const key = keyOfValue(active);
      if (key === AUTO_KEY) {
        return (
          <>
            <ModelSelectorPreviewTitle
              icon={<SparklesIcon aria-hidden className="size-4" />}
            >
              {autoLabel}
            </ModelSelectorPreviewTitle>
            <ModelSelectorPreviewNote>
              {autoDescription}
            </ModelSelectorPreviewNote>
          </>
        );
      }
      const choice = findChoiceByKey(groups, key);
      return choice ? <ChoicePreview choice={choice} /> : null;
    },
    [autoDescription, autoLabel, groups]
  );

  const sections: Section[] = [];
  if (showRecents) {
    sections.push({
      key: "recent",
      node: (
        <ModelSelectorGroup heading={t`Recently used`}>
          {recents.map((choice) => (
            <ChoiceRow
              choice={choice}
              current={currentKey}
              key={choice.key}
              onChoose={choose}
              value={`${RECENT_PREFIX}${choice.key}`}
            />
          ))}
        </ModelSelectorGroup>
      ),
    });
  }
  if (shown.auto && groups.autoOffered) {
    sections.push({
      key: "auto",
      node: (
        <ModelSelectorGroup>
          <ModelSelectorItem
            aria-current={currentKey === AUTO_KEY ? "true" : undefined}
            disabled={!groups.autoAvailable}
            onSelect={choose}
            value={AUTO_KEY}
          >
            <SparklesIcon aria-hidden className="mt-0.5" />
            <span className="flex min-w-0 flex-1 flex-col">
              <ModelSelectorName>{autoLabel}</ModelSelectorName>
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
              key={choice.key}
              onChoose={choose}
              value={choice.key}
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
              key={choice.key}
              onChoose={choose}
              value={choice.key}
            />
          ))}
        </ModelSelectorGroup>
      ),
    });
  }

  const currentModel = current?.model;
  let triggerIcon: ReactNode = <SparklesIcon aria-hidden />;
  if (value.type === "agent") {
    triggerIcon = <AgentIcon aria-hidden />;
  } else if (currentModel) {
    const vendor = modelVendor(currentModel);
    triggerIcon = (
      <ModelSelectorLogo
        name={providerLabel(vendor) || label}
        provider={vendor}
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
            className="min-w-0 max-w-48 shrink rounded-full text-muted-foreground hover:text-foreground aria-expanded:text-foreground max-sm:max-w-36"
            size="sm"
          />
        }
      >
        {triggerIcon}
        <span className="truncate">{label}</span>
        <ChevronDownIcon
          aria-hidden
          className="size-3.5 opacity-60 max-sm:hidden"
        />
      </ModelSelectorTrigger>
      <ModelSelectorContent
        command={{
          label: t`Models and agents`,
          loop: true,
          onValueChange: setHighlighted,
          shouldFilter: false,
          value: highlighted,
        }}
        preview={preview}
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
