import type { Me } from "@workspace/contract/schemas/meta";
import {
  AUTO_MODEL,
  type ModelOption,
  parseModelRef,
} from "@workspace/contract/schemas/models";
import type { RunTarget } from "@workspace/contract/schemas/runs";
import type {
  ChatContext,
  ChatContextType,
} from "@workspace/contract/schemas/tenancy";

import type {
  AgentOption,
  AgentSource,
  ContextOption,
  MentionCandidate,
  PromptOption,
} from "./schemas";

// Turning contract data into what the pickers and menus list. Pure, so the
// grouping and matching rules are tested without rendering anything.

/** "Pick a model for me": the Decider routes each turn (D15). */
export const AUTO_TARGET: RunTarget = { model: AUTO_MODEL, type: "model" };

/** A stable string for a target, for radio values and React keys. */
export const targetKey = (target: RunTarget): string =>
  target.type === "agent" ? `agent:${target.id}` : `model:${target.model}`;

export interface TargetChoice {
  readonly available: boolean;
  readonly key: string;
  readonly label: string;
  readonly target: RunTarget;
}

export interface AgentGroup {
  readonly choices: readonly TargetChoice[];
  /** `null` for agents that didn't say where they come from. */
  readonly source: AgentSource | null;
}

export interface TargetGroups {
  /** Agents by where they come from: mine, shared with me, team & org libraries. */
  readonly agentGroups: readonly AgentGroup[];
  /** Every agent, in the order the groups list them. */
  readonly agents: readonly TargetChoice[];
  /** Whether `auto` can run in this context; its label is the composer's to translate. */
  readonly autoAvailable: boolean;
  /** Models by provider, in the order the server listed them. */
  readonly providers: readonly {
    readonly choices: readonly TargetChoice[];
    readonly provider: string;
  }[];
}

const modelChoice = (model: ModelOption): TargetChoice => {
  const target: RunTarget = { model: model.selector, type: "model" };
  return {
    available: model.available,
    key: targetKey(target),
    label: model.label,
    target,
  };
};

const agentChoice = (agent: AgentOption): TargetChoice => {
  const target: RunTarget = { id: agent.id, type: "agent" };
  return { available: true, key: targetKey(target), label: agent.name, target };
};

const AGENT_SOURCE_ORDER: readonly (AgentSource | null)[] = [
  null,
  "mine",
  "shared",
  "libraries",
];

/**
 * The picker's groups: Auto, then agents, then models by provider. An alias
 * is filed under the provider it resolves to. `auto` in the model list only
 * says whether Auto is available; it never appears twice.
 */
export const buildTargetGroups = (
  models: readonly ModelOption[],
  agents: readonly AgentOption[]
): TargetGroups => {
  const providers: { choices: TargetChoice[]; provider: string }[] = [];
  for (const model of models) {
    if (model.selector === AUTO_MODEL) {
      continue;
    }
    const provider =
      parseModelRef(model.target ?? model.selector)?.provider ?? "";
    const group = providers.find((entry) => entry.provider === provider);
    if (group === undefined) {
      providers.push({ choices: [modelChoice(model)], provider });
    } else {
      group.choices.push(modelChoice(model));
    }
  }
  const agentGroups = AGENT_SOURCE_ORDER.flatMap((source): AgentGroup[] => {
    const choices = agents
      .filter((agent) => (agent.source ?? null) === source)
      .map(agentChoice);
    return choices.length > 0 ? [{ choices, source }] : [];
  });
  return {
    agentGroups,
    agents: agentGroups.flatMap((group) => group.choices),
    autoAvailable:
      models.find((model) => model.selector === AUTO_MODEL)?.available ?? true,
    providers,
  };
};

/** The choice for a target, if the groups list it. */
export const findTargetChoice = (
  groups: TargetGroups,
  target: RunTarget
): TargetChoice | undefined => {
  const key = targetKey(target);
  return [
    ...groups.agents,
    ...groups.providers.flatMap((group) => group.choices),
  ].find((choice) => choice.key === key);
};

export const isAutoTarget = (target: RunTarget): boolean =>
  target.type === "model" && target.model === AUTO_MODEL;

export const contextKey = (context: ChatContext): string =>
  context.type === "personal" ? "personal" : `${context.type}:${context.id}`;

/**
 * The contexts a user can pick (D17): Personal, their teams, then their orgs
 * (not the hidden personal org), limited to the types the instance allows.
 */
export const contextOptionsFromMe = (
  me: Pick<Me, "orgs" | "teams">,
  allowed: readonly ChatContextType[]
): readonly ContextOption[] => [
  ...(allowed.includes("personal")
    ? [{ context: { type: "personal" } } satisfies ContextOption]
    : []),
  ...(allowed.includes("team")
    ? me.teams.map(
        ({ team }): ContextOption => ({
          context: { id: team.id, type: "team" },
          name: team.name,
        })
      )
    : []),
  ...(allowed.includes("org")
    ? me.orgs
        .filter((org) => !org.isPersonal)
        .map(
          (org): ContextOption => ({
            context: { id: org.id, type: "org" },
            name: org.name,
          })
        )
    : []),
];

// Suggestions stay short enough to scan; typing narrows the rest.
const SUGGESTION_LIMIT = 8;

const rank = <T>(
  items: readonly T[],
  query: string,
  keys: (item: T) => readonly (string | undefined)[]
): readonly T[] => {
  const needle = query.trim().toLowerCase();
  const scored: { item: T; score: number }[] = [];
  for (const item of items) {
    const haystacks = keys(item).flatMap((key) =>
      key === undefined ? [] : [key.toLowerCase()]
    );
    if (haystacks.some((key) => key.startsWith(needle))) {
      scored.push({ item, score: 0 });
    } else if (haystacks.some((key) => key.includes(needle))) {
      scored.push({ item, score: 1 });
    }
  }
  // Stable sort: prefix matches first, otherwise the caller's order.
  return scored
    .sort((a, b) => a.score - b.score)
    .slice(0, SUGGESTION_LIMIT)
    .map(({ item }) => item);
};

/** Templates for `/query`: by slash command, then name. */
export const filterPrompts = (
  prompts: readonly PromptOption[],
  query: string
): readonly PromptOption[] =>
  rank(prompts, query, (prompt) => [prompt.definition.command, prompt.name]);

/** Candidates for `@query`: by label. */
export const filterMentions = (
  candidates: readonly MentionCandidate[],
  query: string
): readonly MentionCandidate[] =>
  rank(candidates, query, (candidate) => [candidate.label]);
