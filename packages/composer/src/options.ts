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

import {
  type AgentOption,
  type AgentSource,
  type ComposerCommand,
  type ContextOption,
  composerCommandSchema,
  type FileCandidate,
  type MentionCandidate,
  type PromptOption,
} from "./schemas";
import { slashStage } from "./triggers";

// Turning contract data into what the pickers and menus list. Pure, so the
// grouping and matching rules are tested without rendering anything.

/** "Pick a model for me": the Decider routes each turn (D15). */
export const AUTO_TARGET: RunTarget = { model: AUTO_MODEL, type: "model" };

/** A stable string for a target, for radio values and React keys. */
export const targetKey = (target: RunTarget): string =>
  target.type === "agent" ? `agent:${target.id}` : `model:${target.model}`;

export interface TargetChoice {
  readonly available: boolean;
  /** A one-line "why pick this", shown under the label when there is one (096). */
  readonly description?: string;
  /**
   * The model id behind an alias (`claude-opus-5-5` for `strong`), shown
   * muted beside the label; unset when the label already is the model.
   */
  readonly detail?: string;
  readonly key: string;
  readonly label: string;
  /** Everything the picker's search matches on, lowercased. */
  readonly search: string;
  readonly target: RunTarget;
}

export interface AgentGroup {
  readonly choices: readonly TargetChoice[];
  /** `null` for agents that didn't say where they come from. */
  readonly source: AgentSource | null;
}

export interface ProviderGroup {
  readonly choices: readonly TargetChoice[];
  /** The display name: a known vendor's name, else the id as written. */
  readonly label: string;
  /** The vendor id (`anthropic`); `""` for models with no ref to read one from. */
  readonly provider: string;
}

export interface TargetGroups {
  /** Agents by where they come from: mine, shared with me, team & org libraries. */
  readonly agentGroups: readonly AgentGroup[];
  /** Every agent, in the order the groups list them. */
  readonly agents: readonly TargetChoice[];
  /** Whether `auto` can run in this context; its label is the composer's to translate. */
  readonly autoAvailable: boolean;
  /** Models by provider, in the order the server first listed each provider. */
  readonly providers: readonly ProviderGroup[];
}

// Display names for vendors whose ids don't capitalise into their names.
// Cosmetic only: grouping and routing never depend on this list (D3), and an
// id it doesn't know shows as written.
const VENDOR_NAMES: Readonly<Record<string, string>> = {
  anthropic: "Anthropic",
  cohere: "Cohere",
  deepseek: "DeepSeek",
  gateway: "Gateway",
  google: "Google",
  groq: "Groq",
  meta: "Meta",
  mistral: "Mistral",
  moonshotai: "Moonshot AI",
  ollama: "Ollama",
  openai: "OpenAI",
  openrouter: "OpenRouter",
  perplexity: "Perplexity",
  xai: "xAI",
};

/** A vendor id as people know it: `openai` is OpenAI. */
export const providerLabel = (provider: string): string =>
  VENDOR_NAMES[provider] ?? provider;

const VENDOR = /^([a-z][a-z0-9_-]{0,63})\/./i;

/**
 * Who makes a model: the server's `provider` when it sends one (096), else
 * read from the ref, for older servers. A ref through an aggregator names
 * the vendor after the colon (`gateway:anthropic/claude-haiku-4.5`), so that
 * vendor wins over the configured provider key; otherwise the key is it.
 * `""` for an option with no ref.
 */
export const modelVendor = (model: ModelOption): string => {
  if (model.provider !== undefined && model.provider !== "") {
    return model.provider;
  }
  const ref = parseModelRef(model.target ?? model.selector);
  if (ref === undefined) {
    return "";
  }
  const vendor = VENDOR.exec(ref.modelId)?.[1];
  return vendor === undefined ? ref.provider : vendor.toLowerCase();
};

const searchText = (parts: readonly (string | undefined)[]): string =>
  parts
    .filter((part) => part !== undefined && part !== "")
    .join(" ")
    .toLowerCase();

const modelChoice = (model: ModelOption, vendor: string): TargetChoice => {
  const target: RunTarget = { model: model.selector, type: "model" };
  const ref = model.target ?? model.selector;
  const modelId = parseModelRef(ref)?.modelId;
  // An alias (`strong`) says nothing about which model answers; the ref's
  // model id does. A ref's own label already is its model id.
  const detail =
    parseModelRef(model.selector) === undefined &&
    modelId !== undefined &&
    modelId !== model.label
      ? modelId
      : undefined;
  const description = model.description?.trim() || undefined;
  return {
    available: model.available,
    ...(description === undefined ? {} : { description }),
    ...(detail === undefined ? {} : { detail }),
    key: targetKey(target),
    label: model.label,
    search: searchText([
      model.label,
      description,
      model.selector,
      model.target ?? undefined,
      vendor,
      providerLabel(vendor),
    ]),
    target,
  };
};

const agentChoice = (agent: AgentOption): TargetChoice => {
  const target: RunTarget = { id: agent.id, type: "agent" };
  return {
    available: true,
    key: targetKey(target),
    label: agent.name,
    search: searchText([agent.name]),
    target,
  };
};

const AGENT_SOURCE_ORDER: readonly (AgentSource | null)[] = [
  null,
  "mine",
  "shared",
  "libraries",
];

/**
 * The picker's groups: Auto, models by provider, then agents by where they
 * come from. An alias is filed under the vendor it resolves to. `auto` in
 * the model list only says whether Auto is available; it never appears twice.
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
    const provider = modelVendor(model);
    const choice = modelChoice(model, provider);
    const group = providers.find((entry) => entry.provider === provider);
    if (group === undefined) {
      providers.push({ choices: [choice], provider });
    } else {
      group.choices.push(choice);
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
    providers: providers.map((group) => ({
      ...group,
      label: providerLabel(group.provider),
    })),
  };
};

const WHITESPACE = /\s+/;

/**
 * Whether `text` (already lowercased) matches a search: every word of the
 * query appears somewhere in it, in any order, so "opus anth" finds
 * Anthropic's Opus.
 */
export const matchesSearch = (text: string, query: string): boolean =>
  query
    .toLowerCase()
    .split(WHITESPACE)
    .every((word) => text.includes(word));

export interface FilteredTargets {
  readonly agentGroups: readonly AgentGroup[];
  /** Whether Auto matches the query (its words are the caller's, translated). */
  readonly auto: boolean;
  readonly providers: readonly ProviderGroup[];
}

/**
 * The picker's groups narrowed to a search, dropping groups left empty.
 * Every model and agent is searched; nothing is capped. A model's provider
 * is part of what it matches, so "anthropic" lists every Anthropic model.
 */
export const filterTargetGroups = (
  groups: TargetGroups,
  query: string,
  autoText: string
): FilteredTargets => {
  const needle = query.trim();
  if (needle === "") {
    return {
      agentGroups: groups.agentGroups,
      auto: true,
      providers: groups.providers,
    };
  }
  const keep = <G extends { readonly choices: readonly TargetChoice[] }>(
    group: G
  ): G[] => {
    const choices = group.choices.filter((choice) =>
      matchesSearch(choice.search, needle)
    );
    return choices.length > 0 ? [{ ...group, choices }] : [];
  };
  return {
    agentGroups: groups.agentGroups.flatMap(keep),
    auto: matchesSearch(autoText.toLowerCase(), needle),
    providers: groups.providers.flatMap(keep),
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

/**
 * Candidates for `@query`: agents and people by label, then files by name or
 * path. Files are ranked on their own so a workspace full of them never
 * crowds the people out of the list.
 */
export const filterMentions = (
  candidates: readonly MentionCandidate[],
  query: string
): readonly MentionCandidate[] => [
  ...rank(
    candidates.filter((candidate) => candidate.kind !== "file"),
    query,
    (candidate) => [candidate.label]
  ),
  ...rank(
    candidates.filter((candidate) => candidate.kind === "file"),
    query,
    (candidate) => [
      candidate.label,
      candidate.kind === "file" ? candidate.path : undefined,
    ]
  ),
];

/** A row in the `/` menu. */
export type SlashItem =
  | { readonly command: ComposerCommand; readonly kind: "command" }
  | { readonly file: FileCandidate; readonly kind: "file" }
  | { readonly kind: "prompt"; readonly prompt: PromptOption };

export interface SlashSources {
  /** The file commands the host handles; the rest aren't offered. */
  readonly commands: readonly ComposerCommand[];
  readonly files: readonly FileCandidate[];
  readonly prompts: readonly PromptOption[];
}

/**
 * The `/` menu for a query: the host's file commands (always in the same
 * order), then prompt templates; or, after `/open`, the files to open.
 */
export const slashItems = (
  query: string,
  { commands, files, prompts }: SlashSources
): readonly SlashItem[] => {
  const stage = slashStage(query);
  if (stage.stage === "open") {
    return rank(files, stage.query, (file) => [file.label, file.path]).map(
      (file): SlashItem => ({ file, kind: "file" })
    );
  }
  const offered = composerCommandSchema.options.filter((command) =>
    commands.includes(command)
  );
  return [
    ...rank(offered, stage.query, (command) => [command]).map(
      (command): SlashItem => ({ command, kind: "command" })
    ),
    ...filterPrompts(prompts, stage.query).map(
      (prompt): SlashItem => ({ kind: "prompt", prompt })
    ),
  ];
};
