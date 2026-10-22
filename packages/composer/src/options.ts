import type { Connector } from "@workspace/contract/schemas/library";
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
import { brandName } from "@workspace/icons/brands";
import { matchMcpServers } from "./mcp";
import {
  type AgentOption,
  type AgentSource,
  type ArtifactOption,
  type ComposerCommand,
  type ComposerMode,
  type ContextOption,
  composerCommandSchema,
  type FileCandidate,
  type MentionCandidate,
  type PromptOption,
  type SkillOption,
} from "./schemas";
import { slashStage } from "./triggers";
import {
  type FoldedModels,
  familyMembers,
  foldModelVariants,
} from "./variants";

// Turning contract data into what the pickers and menus list. Pure, so the
// grouping and matching rules are tested without rendering anything.

/** "Pick a model for me": the Decider routes each turn (D15). */
export const AUTO_TARGET: RunTarget = { model: AUTO_MODEL, type: "model" };

/** A stable string for a target, for radio values and React keys. */
export const targetKey = (target: RunTarget): string =>
  target.type === "agent" ? `agent:${target.id}` : `model:${target.model}`;

export interface TargetChoice {
  /** The agent a row picks, for its preview card. */
  readonly agent?: AgentOption;
  readonly available: boolean;
  /** A one-line "why pick this" (096), for the card and search; not the row (105). */
  readonly description?: string;
  /**
   * The model id behind an alias (`claude-opus-5-5` for `strong`), shown
   * muted beside the label; unset when the label already is the model.
   */
  readonly detail?: string;
  readonly key: string;
  /**
   * The row's name: an alias as written, else the model's display name
   * without a vendor prefix ("Claude Opus 4", not `anthropic/claude-opus-4`).
   */
  readonly label: string;
  /** The model a row picks, for its preview card (099). */
  readonly model?: ModelOption;
  /** Everything the picker's search matches on, lowercased. */
  readonly search: string;
  readonly target: RunTarget;
  /** Who makes the model (`anthropic`); `""` when that's unknown. */
  readonly vendor?: string;
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
  /** Whether the server offers `auto` at all (`models.auto.enabled`). */
  readonly autoOffered: boolean;
  /** The models with modes of a model folded into it (105). */
  readonly folded: FoldedModels;
  /** Models by provider, in the order the server first listed each provider. */
  readonly providers: readonly ProviderGroup[];
}

/**
 * A vendor id as people know it: `openai` is OpenAI. The names live with the
 * logos in `@workspace/icons/brands`; an id it doesn't know shows as written.
 * Cosmetic only: grouping and routing never depend on it (D3).
 */
export const providerLabel = (provider: string): string => brandName(provider);

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

/**
 * A model's name without the vendor before a `/` (`openai/gpt-6` is
 * `gpt-6`): the section heading and the row's end already say who makes it.
 * For servers older than 099, which send no `displayName`.
 */
export const bareModelName = (label: string): string =>
  label.slice(label.lastIndexOf("/") + 1) || label;

/** What a model's row is called: its display name, else its bare label. */
export const modelName = (model: ModelOption): string =>
  model.displayName?.trim() || bareModelName(model.label);

const modelChoice = (
  model: ModelOption,
  vendor: string,
  members: readonly ModelOption[]
): TargetChoice => {
  const target: RunTarget = { model: model.selector, type: "model" };
  const ref = model.target ?? model.selector;
  const modelId = parseModelRef(ref)?.modelId;
  const isAlias = parseModelRef(model.selector) === undefined;
  // An alias (`strong`) shows as the model it names (114, Connor: aliases
  // read as confusing); it still finds the row in a search and still works
  // for chats saved with it.
  const named = model.displayName?.trim() || modelId;
  const description = model.description?.trim() || undefined;
  return {
    available: model.available,
    ...(description === undefined ? {} : { description }),
    key: targetKey(target),
    label: isAlias ? (named ?? model.label) : modelName(model),
    model,
    search: searchText([
      model.label,
      model.displayName,
      description,
      model.selector,
      model.target ?? undefined,
      vendor,
      providerLabel(vendor),
      // The entries folded into it (105) still find it.
      ...members.flatMap((member) => [
        member.label,
        member.displayName,
        member.selector,
      ]),
    ]),
    target,
    vendor,
  };
};

const agentChoice = (agent: AgentOption): TargetChoice => {
  const target: RunTarget = { id: agent.id, type: "agent" };
  return {
    agent,
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
 * An entry that's only a mode of another model (`o4-mini-high`) is folded
 * into it, and comes back as its thinking level or fast mode (105).
 */
export const buildTargetGroups = (
  models: readonly ModelOption[],
  agents: readonly AgentOption[]
): TargetGroups => {
  const folded = foldModelVariants(models);
  const providers: { choices: TargetChoice[]; provider: string }[] = [];
  for (const model of folded.models) {
    if (model.selector === AUTO_MODEL) {
      continue;
    }
    const provider = modelVendor(model);
    const family = folded.families.get(model.selector);
    const choice = modelChoice(
      model,
      provider,
      family ? familyMembers(family) : []
    );
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
    autoOffered: models.some((model) => model.selector === AUTO_MODEL),
    folded,
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

/**
 * The target a row stands for: a folded entry's base model, without the
 * level it runs at; anything else as it is.
 */
export const listedTarget = (
  groups: TargetGroups,
  target: RunTarget
): RunTarget =>
  target.type === "model"
    ? {
        model: groups.folded.baseOf.get(target.model) ?? target.model,
        type: "model",
      }
    : target;

/** The choice for a target (its base model's, for a folded entry), if listed. */
export const findTargetChoice = (
  groups: TargetGroups,
  target: RunTarget
): TargetChoice | undefined => {
  const key = targetKey(listedTarget(groups, target));
  return [
    ...groups.agents,
    ...groups.providers.flatMap((group) => group.choices),
  ].find((choice) => choice.key === key);
};

// Roughly how many English words a token holds, for the card's context row.
const WORDS_PER_TOKEN = 0.75;

/**
 * A context window for the preview card, compact in `locale`: 200000
 * tokens is "200K", about "150K" words.
 */
export const contextSize = (
  tokens: number,
  locale: string
): { readonly tokens: string; readonly words: string } => {
  const format = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 1,
    notation: "compact",
  });
  return {
    tokens: format.format(tokens),
    words: format.format(Math.round(tokens * WORDS_PER_TOKEN)),
  };
};

/** How many recent picks the picker remembers and shows. */
export const RECENT_LIMIT = 3;

/** `keys` with `key` moved to the front, at most `RECENT_LIMIT` long. */
export const rememberRecent = (
  keys: readonly string[],
  key: string,
  limit = RECENT_LIMIT
): readonly string[] =>
  [key, ...keys.filter((each) => each !== key)].slice(0, limit);

/**
 * The remembered picks the picker still offers, newest first: a model since
 * removed or an agent since unshared drops out. Auto is its own row, so it
 * isn't repeated here.
 */
export const recentChoices = (
  groups: TargetGroups,
  keys: readonly string[]
): readonly TargetChoice[] =>
  keys.flatMap((key) => {
    const choice = [
      ...groups.providers.flatMap((group) => group.choices),
      ...groups.agents,
    ].find((each) => each.key === key);
    return choice ? [choice] : [];
  });

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
/** Per group before anything is typed, so every group shows in the menu. */
const BROWSE_LIMIT = 4;

const rank = <T>(
  items: readonly T[],
  query: string,
  keys: (item: T) => readonly (string | undefined)[],
  limit = SUGGESTION_LIMIT
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
    .slice(0, limit)
    .map(({ item }) => item);
};

/**
 * A row in the composer's menu, which `/` and `@` both open. Picking an
 * agent, skill, artifact type, person or file puts a chip in the text; a
 * prompt puts in its text; upload opens the file picker; a command or an
 * MCP server is the host's to carry out.
 */
export type MenuItem =
  | { readonly agent: AgentOption; readonly kind: "agent" }
  | { readonly kind: "skill"; readonly skill: SkillOption }
  | { readonly kind: "prompt"; readonly prompt: PromptOption }
  | { readonly artifact: ArtifactOption; readonly kind: "artifact" }
  | { readonly kind: "upload" }
  | { readonly kind: "mention"; readonly candidate: MentionCandidate }
  | { readonly command: ComposerCommand; readonly kind: "command" }
  /** Switches a server on or off for this chat (188). */
  | { readonly kind: "mcp-server"; readonly server: Connector }
  /** After `/open`, a workspace file to open. */
  | { readonly file: FileCandidate; readonly kind: "open-file" };

export type MenuItemKind = MenuItem["kind"];

export interface MenuSources {
  /** Agents to mention: that agent answers the message. */
  readonly agents?: readonly AgentOption[];
  /** Artifact types to ask for. */
  readonly artifacts?: readonly ArtifactOption[];
  /** Whether the composer can take files: offers Upload. */
  readonly canUpload?: boolean;
  /** The file commands the host handles; the rest aren't offered. */
  readonly commands?: readonly ComposerCommand[];
  /** This chat's MCP servers (188), found by name after a word is typed. */
  readonly mcpServers?: readonly Connector[];
  /** People and workspace files to mention. */
  readonly mentions?: readonly MentionCandidate[];
  /** Chat leaves out what only Code can do; left out, everything is offered. */
  readonly mode?: ComposerMode;
  readonly prompts?: readonly PromptOption[];
  readonly skills?: readonly SkillOption[];
}

/** What only a Code conversation can do: previewing runs a dev server. */
const CODE_ONLY_COMMANDS: readonly ComposerCommand[] = ["preview"];

const startsAWord = (labels: readonly string[], query: string): boolean => {
  const needle = query.trim().toLowerCase();
  return labels.some((label) =>
    label
      .toLowerCase()
      .split(WHITESPACE)
      .some((word) => word.startsWith(needle))
  );
};

/** Whether Chat mode leaves `item` out of the menu. Pure. */
export const isCodeOnly = (item: MenuItem): boolean =>
  item.kind === "command" && CODE_ONLY_COMMANDS.includes(item.command);

/**
 * The menu for a query, in groups: agents, skills, prompts, artifact
 * types, people and files, upload, then the host's file commands and MCP
 * servers to switch; or, after `/open`, the files to open. Each group is
 * matched and capped on its own, so a long list never crowds out the rest.
 */
export const menuItems = (
  query: string,
  {
    agents = [],
    artifacts = [],
    canUpload = false,
    commands = [],
    mcpServers = [],
    mentions = [],
    mode,
    prompts = [],
    skills = [],
  }: MenuSources,
  uploadLabel = "upload"
): readonly MenuItem[] => {
  const stage = slashStage(query);
  if (stage.stage === "open") {
    return rank(
      mentions.filter(
        (candidate): candidate is FileCandidate => candidate.kind === "file"
      ),
      stage.query,
      (file) => [file.label, file.path]
    ).map((file): MenuItem => ({ file, kind: "open-file" }));
  }
  const needle = stage.query;
  const limit = needle.trim() === "" ? BROWSE_LIMIT : SUGGESTION_LIMIT;
  const find = <T>(
    list: readonly T[],
    keys: (item: T) => readonly (string | undefined)[]
  ) => rank(list, needle, keys, limit);
  const offered = composerCommandSchema.options.filter((command) =>
    commands.includes(command)
  );
  const items: MenuItem[] = [
    ...find(agents, (agent) => [agent.name, agent.description]).map(
      (agent): MenuItem => ({ agent, kind: "agent" })
    ),
    ...find(skills, (skill) => [skill.name, skill.description]).map(
      (skill): MenuItem => ({ kind: "skill", skill })
    ),
    ...find(prompts, (prompt) => [prompt.definition.command, prompt.name]).map(
      (prompt): MenuItem => ({ kind: "prompt", prompt })
    ),
    // A short, fixed list: every kind shows, typed or not.
    ...rank(artifacts, needle, (artifact) => [
      artifact.label,
      artifact.kind,
    ]).map((artifact): MenuItem => ({ artifact, kind: "artifact" })),
    ...find(
      mentions.filter((candidate) => candidate.kind === "user"),
      (candidate) => [candidate.label]
    ).map((candidate): MenuItem => ({ candidate, kind: "mention" })),
    ...find(
      mentions.filter((candidate) => candidate.kind === "file"),
      (candidate) => [
        candidate.label,
        candidate.kind === "file" ? candidate.path : undefined,
      ]
    ).map((candidate): MenuItem => ({ candidate, kind: "mention" })),
    // Last of what goes in the message, and found only by how its words
    // start: "@ad" is Ada, not "Upload".
    ...(canUpload && startsAWord([uploadLabel, "upload", "attach"], needle)
      ? [{ kind: "upload" } as const]
      : []),
    ...find(offered, (command) => [command]).map(
      (command): MenuItem => ({ command, kind: "command" })
    ),
    ...matchMcpServers(mcpServers, needle).map(
      (server): MenuItem => ({ kind: "mcp-server", server })
    ),
  ];
  return mode === "chat" ? items.filter((item) => !isCodeOnly(item)) : items;
};
