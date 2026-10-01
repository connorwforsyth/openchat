"use client";

import { useLingui } from "@lingui/react/macro";
import { tidyModelName, vendorOf } from "@workspace/ai/providers/describe";
import {
  modelName,
  modelVendor,
  providerLabel,
} from "@workspace/composer/options";
import type { AgentOption } from "@workspace/composer/schemas";
import type { LibraryItemId } from "@workspace/contract/schemas/common";
import {
  type ModelOption,
  type ModelRef,
  parseModelRef,
} from "@workspace/contract/schemas/models";
import { AgentIcon } from "@workspace/icons";
import { ModelSelectorLogo } from "@workspace/ui/components/ai-elements/model-selector";
import { Separator } from "@workspace/ui/components/separator";
import type { ReactNode } from "react";

import type { AnswerSwitch } from "./switches";

// The divider before an answer whose model or agent changed (107): a
// hairline, a mark and a name, centred and quiet. It's a separator, not a
// message: no row, no actions, and it can't be selected, so copying the
// conversation leaves it out.

interface NamedModel {
  readonly name: string;
  /** Who makes it, for the mark: a `brands.ts` id, or `""`. */
  readonly vendor: string;
}

/**
 * A ref as the picker names it: the offered option's display name (the ref's
 * own row before an alias that points at it), else tidied from the ref, for
 * a model this instance no longer offers.
 */
export const namedModel = (
  ref: ModelRef,
  models: readonly ModelOption[]
): NamedModel => {
  const option =
    models.find((model) => model.selector === ref) ??
    models.find((model) => model.target === ref);
  if (option !== undefined) {
    return { name: modelName(option), vendor: modelVendor(option) };
  }
  return {
    name: tidyModelName(parseModelRef(ref)?.modelId ?? ref),
    vendor: vendorOf(ref) ?? "",
  };
};

// An agent's `icon` is a registry name or an emoji; only an emoji draws as
// itself, since no registry names are drawn anywhere yet.
const EMOJI = /\p{Extended_Pictographic}/u;

function ModelMark({ model }: { readonly model: NamedModel }) {
  return (
    <ModelSelectorLogo
      name={providerLabel(model.vendor) || model.name}
      provider={model.vendor}
    />
  );
}

function AgentMark({ agent }: { readonly agent: AgentOption | undefined }) {
  const icon = agent?.icon?.trim();
  if (icon && EMOJI.test(icon)) {
    return (
      <span aria-hidden className="text-sm leading-none">
        {icon}
      </span>
    );
  }
  return <AgentIcon aria-hidden className="size-3.5" />;
}

export interface SwitchMarkerProps {
  readonly agents: readonly AgentOption[];
  readonly models: readonly ModelOption[];
  readonly value: AnswerSwitch;
}

const findAgent = (
  agents: readonly AgentOption[],
  id: LibraryItemId
): AgentOption | undefined => agents.find((agent) => agent.id === id);

export function SwitchMarker({ agents, models, value }: SwitchMarkerProps) {
  const { t } = useLingui();
  let label: string;
  let content: ReactNode;
  if (value.kind === "agent") {
    const agent = findAgent(agents, value.agentId);
    const agentName = agent?.name ?? t`Removed agent`;
    const model =
      value.model === null ? undefined : namedModel(value.model, models);
    const modelLabel = model?.name;
    label =
      modelLabel === undefined
        ? t`Switched to ${agentName}`
        : t`Switched to ${agentName} with ${modelLabel}`;
    content = (
      <>
        <AgentMark agent={agent} />
        <span className="truncate text-foreground/80">{agentName}</span>
        {model === undefined ? null : (
          <span className="truncate">{model.name}</span>
        )}
      </>
    );
  } else {
    const model = namedModel(value.model, models);
    const modelLabel = model.name;
    label = t`Switched to ${modelLabel}`;
    content = (
      <>
        <ModelMark model={model} />
        <span className="truncate text-foreground/80">{model.name}</span>
      </>
    );
  }
  // Base UI's separator gives the role and orientation; the hairlines are
  // drawn either side of the name rather than by the element itself.
  return (
    <Separator
      aria-label={label}
      className="flex select-none items-center gap-3 bg-transparent text-muted-foreground text-xs data-horizontal:h-auto"
      data-slot="switch-marker"
    >
      <span className="h-px min-w-6 flex-1 bg-border" />
      <span className="flex min-w-0 max-w-[80%] items-center gap-1.5">
        {content}
      </span>
      <span className="h-px min-w-6 flex-1 bg-border" />
    </Separator>
  );
}
