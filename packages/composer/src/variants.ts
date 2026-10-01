import {
  type ModelOption,
  type ModelParameters,
  parseModelRef,
} from "@workspace/contract/schemas/models";
import type { RunTarget } from "@workspace/contract/schemas/runs";
import { z } from "zod";

// Thinking levels and fast mode (105). A catalog often lists a mode of a
// model as a model of its own (`o4-mini-high`, `claude-3.7-sonnet:thinking`,
// the gateway's `claude-opus-5-fast`). Those fold into the model they're a
// mode of, and come back as a thinking level or the fast switch. Pure, so
// the rules are tested without rendering anything.

/**
 * A thinking level. `default` sends nothing, so the provider's default
 * applies; `on` is a folded `-thinking` entry, for a model whose only
 * choice is thinking or not. The rest are the provider's effort levels.
 */
export const thinkingLevelSchema = z.enum([
  "default",
  "off",
  "on",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);
export type ThinkingLevel = z.infer<typeof thinkingLevelSchema>;

type Effort = NonNullable<ModelParameters["reasoningEffort"]>;

// The levels the contract can already send, as the model target's
// `parameters.reasoningEffort` (the AI SDK's `reasoning` call setting, see
// `packages/ai/src/agent/call-settings.ts`). The others need a wider enum.
const EFFORTS: Readonly<Partial<Record<ThinkingLevel, Effort>>> = {
  high: "high",
  low: "low",
  medium: "medium",
  off: "off",
};

// Suffixes that name a mode of a model, not another model. `-mini`,
// `-nano`, sizes and versions are other models and never fold.
const THINKING_SUFFIXES: readonly (readonly [string, ThinkingLevel])[] = [
  [":thinking", "on"],
  ["-thinking", "on"],
  ["-reasoning", "on"],
  ["-high", "high"],
];
const FAST_SUFFIXES: readonly string[] = ["-fast", "-instant", "-turbo"];

export interface ThinkingVariant {
  readonly level: ThinkingLevel;
  readonly model: ModelOption;
}

/** A model with the entries that are only a mode of it. */
export interface ModelFamily {
  readonly base: ModelOption;
  /** A folded fast entry (`-fast`, `-instant`, `-turbo`). */
  readonly fast?: ModelOption;
  /** Folded thinking entries, each the level that picks it. */
  readonly thinking: readonly ThinkingVariant[];
}

export interface FoldedModels {
  /** The variant's selector to its base's, for each folded entry. */
  readonly baseOf: ReadonlyMap<string, string>;
  /** Every model that's still listed, by selector, with its variants. */
  readonly families: ReadonlyMap<string, ModelFamily>;
  /** The list without the folded entries, in the server's order. */
  readonly models: readonly ModelOption[];
}

type Fold =
  | { readonly base: string; readonly kind: "fast" }
  | {
      readonly base: string;
      readonly kind: "thinking";
      readonly level: ThinkingLevel;
    };

const foldOf = (selector: string): Fold | undefined => {
  // Only refs fold: an alias (`strong`) is a name someone chose on purpose.
  if (parseModelRef(selector) === undefined) {
    return;
  }
  const lower = selector.toLowerCase();
  for (const [suffix, level] of THINKING_SUFFIXES) {
    if (lower.endsWith(suffix)) {
      return {
        base: selector.slice(0, -suffix.length),
        kind: "thinking",
        level,
      };
    }
  }
  for (const suffix of FAST_SUFFIXES) {
    if (lower.endsWith(suffix)) {
      return { base: selector.slice(0, -suffix.length), kind: "fast" };
    }
  }
};

/**
 * Folds each catalog entry that's only a mode of another listed model into
 * it: `openai:o4-mini-high` becomes o4-mini's High level, and
 * `gateway:anthropic/claude-opus-5-fast` its fast mode. An entry folds only
 * when its base (the same ref without the suffix) is listed too, and isn't
 * itself folded; otherwise it stays a row of its own.
 */
export const foldModelVariants = (
  models: readonly ModelOption[]
): FoldedModels => {
  const listed = new Set(models.map((model) => model.selector));
  const folds = new Map<string, Fold>();
  for (const model of models) {
    const fold = foldOf(model.selector);
    if (fold && listed.has(fold.base) && foldOf(fold.base) === undefined) {
      folds.set(model.selector, fold);
    }
  }
  const kept = models.filter((model) => !folds.has(model.selector));
  const families = new Map<
    string,
    { base: ModelOption; fast?: ModelOption; thinking: ThinkingVariant[] }
  >(kept.map((model) => [model.selector, { base: model, thinking: [] }]));
  const baseOf = new Map<string, string>();
  for (const model of models) {
    const fold = folds.get(model.selector);
    const family = fold ? families.get(fold.base) : undefined;
    if (!(fold && family)) {
      continue;
    }
    baseOf.set(model.selector, fold.base);
    if (fold.kind === "fast") {
      // Two fast entries for one model (`-fast` and `-turbo`): the first wins
      // and the other stays findable by search, through the base.
      family.fast ??= model;
    } else if (!family.thinking.some((each) => each.level === fold.level)) {
      family.thinking.push({ level: fold.level, model });
    }
  }
  return { baseOf, families, models: kept };
};

/** Every entry folded into a family, for search. */
export const familyMembers = (family: ModelFamily): readonly ModelOption[] => [
  ...family.thinking.map((variant) => variant.model),
  ...(family.fast ? [family.fast] : []),
];

// ---- What each provider supports ----

/** A provider level, and whether the contract can send it yet. */
export interface ProviderLevel {
  readonly level: ThinkingLevel;
  /** Only with a wider `reasoningEffort` enum in `packages/contract`. */
  readonly needsServer: boolean;
}

const level = (each: ThinkingLevel): ProviderLevel => ({
  level: each,
  needsServer: EFFORTS[each] === undefined,
});

const VENDOR_PREFIX = /^[^/]+\//;

/** The model id without a provider or vendor, lowercased, dots as dashes. */
const bareId = (model: ModelOption): string => {
  const ref = parseModelRef(model.target ?? model.selector);
  return (ref?.modelId ?? "")
    .replace(VENDOR_PREFIX, "")
    .toLowerCase()
    .replaceAll(".", "-");
};

// Anthropic: models the SDK sends adaptive thinking with an effort to. The
// rest get a token budget, which Low, Medium and High scale.
const ANTHROPIC_ADAPTIVE = /claude-(opus|sonnet|fable)-(4-[6-9]|[5-9])/;
// Anthropic models that always think: the SDK turns "off" into low effort.
const ANTHROPIC_ALWAYS_THINKS = /claude-(opus-5-5|fable-5)/;
const OPENAI_O_SERIES = /^o\d/;
const OPENAI_GPT = /^gpt-(\d+)(?:-(\d+))?/;
const OPENAI_GPT6_NONE = /^gpt-6-(sol|luna)/;
const GEMINI_2 = /^gemini-(1|2)-/;
const GEMINI_25_PRO = /^gemini-2-5-pro/;

const anthropicLevels = (id: string): readonly ProviderLevel[] => [
  ...(ANTHROPIC_ALWAYS_THINKS.test(id) ? [] : [level("off")]),
  level("low"),
  level("medium"),
  level("high"),
  ...(ANTHROPIC_ADAPTIVE.test(id) ? [level("xhigh"), level("max")] : []),
];

const openaiLevels = (id: string): readonly ProviderLevel[] => {
  const gpt = OPENAI_GPT.exec(id);
  const major = gpt ? Number(gpt[1]) : 0;
  const minor = gpt?.[2];
  // `none` exists from GPT-5.1 on; GPT-6 takes it only on sol and luna.
  const off =
    (major === 5 && minor !== undefined) ||
    (major >= 6 && OPENAI_GPT6_NONE.test(id));
  return [
    ...(off ? [level("off")] : []),
    ...(major === 5 && minor === undefined ? [level("minimal")] : []),
    level("low"),
    level("medium"),
    level("high"),
    ...(major >= 6 ? [level("xhigh"), level("max")] : []),
  ];
};

const googleLevels = (id: string): readonly ProviderLevel[] => {
  if (GEMINI_2.test(id)) {
    // A thinking budget; only 2.5 Pro can't turn it down to nothing.
    return [
      ...(GEMINI_25_PRO.test(id) ? [] : [level("off")]),
      level("low"),
      level("medium"),
      level("high"),
    ];
  }
  // Gemini 3 thinks at a level; "off" is its lowest level, not none.
  return [level("minimal"), level("low"), level("medium"), level("high")];
};

/**
 * The thinking levels a reasoning model's provider takes, from what the
 * installed AI SDK providers map the `reasoning` call setting to (105):
 *
 * - Anthropic: off (`thinking: disabled`, except models that always think),
 *   low, medium, high; adaptive models also take xhigh and max effort.
 * - OpenAI: low, medium, high `reasoningEffort`; `none` from GPT-5.1;
 *   `minimal` on GPT-5; xhigh and max on GPT-6.
 * - Google: Gemini 2.5's thinking budget (0 is off, except 2.5 Pro), or
 *   Gemini 3's thinking level (minimal to high, no off).
 * - DeepSeek: thinking off or on, at low or high effort (medium is high).
 * - Anyone else: low, medium and high, passed as OpenAI's `reasoning_effort`,
 *   which the OpenAI-compatible adapter sends as is.
 *
 * Keyed by who makes the model, not the configured provider, since the
 * gateway and Bedrock map the same setting to the maker's API. `undefined`
 * for a model the server doesn't say reasons.
 */
export const providerLevels = (
  model: ModelOption,
  vendor: string
): readonly ProviderLevel[] | undefined => {
  if (!model.capabilities.includes("reasoning")) {
    return;
  }
  const id = bareId(model);
  switch (vendor) {
    case "anthropic":
      return anthropicLevels(id);
    case "openai":
      return OPENAI_O_SERIES.test(id) || OPENAI_GPT.test(id)
        ? openaiLevels(id)
        : [level("low"), level("medium"), level("high")];
    case "google":
      return googleLevels(id);
    case "deepseek":
      return [level("off"), level("low"), level("high"), level("max")];
    default:
      return [level("low"), level("medium"), level("high")];
  }
};

// OpenAI models the SDK sends `serviceTier: "priority"` for (its
// `supportsPriorityProcessing`): GPT-4 and up, o3 and up, but not nano or
// chat models. Anthropic's `speed: "fast"` is documented for Opus 4.6.
const OPENAI_PRIORITY = /^(gpt-4|o([3-9]|\d{2}))/;
const OPENAI_NO_PRIORITY = /-(nano|chat)/;
const ANTHROPIC_FAST = /claude-opus-4-6/;

/**
 * Whether the model's provider has a fast tier for it (105), as the
 * installed AI SDK providers gate it. Asking for it needs a run option the
 * contract doesn't have yet, so it's offered but can't be switched on.
 */
export const providerFastTier = (
  model: ModelOption,
  vendor: string
): boolean => {
  const id = bareId(model);
  const gpt = OPENAI_GPT.exec(id);
  switch (vendor) {
    case "openai":
      return (
        (OPENAI_PRIORITY.test(id) || (gpt !== null && Number(gpt[1]) >= 5)) &&
        !OPENAI_NO_PRIORITY.test(id)
      );
    case "anthropic":
      return ANTHROPIC_FAST.test(id);
    default:
      return false;
  }
};

/** Fast mode for a family: a folded fast entry, else the provider's tier. */
export interface FastMode {
  /** Why it can't be switched on, if it can't. */
  readonly blocked?: Exclude<LevelBlock, "fast">;
  /** The folded entry fast mode picks; absent for a provider tier. */
  readonly model?: ModelOption;
}

/** The family's fast mode, or `undefined` when it has none. */
export const fastMode = (
  family: ModelFamily,
  vendor: string
): FastMode | undefined => {
  if (family.fast) {
    return family.fast.available
      ? { model: family.fast }
      : { blocked: "unavailable", model: family.fast };
  }
  return providerFastTier(family.base, vendor)
    ? { blocked: "server" }
    : undefined;
};

// ---- The choices and the target they make ----

/** Why a level can't be picked. */
export type LevelBlock = "fast" | "server" | "unavailable";

export interface LevelChoice {
  readonly blocked?: LevelBlock;
  readonly level: ThinkingLevel;
  /** The model this level runs, when it's a folded entry of its own. */
  readonly model?: ModelOption;
}

const LEVEL_ORDER = thinkingLevelSchema.options;

const byLevel = (a: LevelChoice, b: LevelChoice): number =>
  LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level);

/**
 * The thinking levels to offer for a family, or `undefined` when there's
 * no choice to make (a model that doesn't reason, with no thinking entry).
 * A folded entry is the level that picks it and wins over the provider's
 * level of the same name, since it works without server support. While
 * fast mode is on, the folded levels can't be had: they're other models.
 */
export const thinkingLevels = (
  family: ModelFamily,
  vendor: string,
  fast: boolean
): readonly LevelChoice[] | undefined => {
  const provider = providerLevels(family.base, vendor);
  if (provider === undefined && family.thinking.length === 0) {
    return;
  }
  const fastOn = fast && family.fast?.available === true;
  const folded = family.thinking.map(
    (variant): LevelChoice => ({
      level: variant.level,
      model: variant.model,
      ...(fastOn ? { blocked: "fast" as const } : {}),
      ...(variant.model.available || fastOn
        ? {}
        : { blocked: "unavailable" as const }),
    })
  );
  const own = (provider ?? []).flatMap((each): LevelChoice[] =>
    folded.some((variant) => variant.level === each.level)
      ? []
      : [
          {
            level: each.level,
            ...(each.needsServer ? { blocked: "server" as const } : {}),
          },
        ]
  );
  // Without provider levels, the base model is the "off" choice.
  const base: LevelChoice[] =
    provider === undefined ? [{ level: "off" }] : [{ level: "default" }];
  return [...base, ...own, ...folded].sort(byLevel);
};

/** What the person chose for a model: a thinking level and fast mode. */
export const variantChoiceSchema = z.object({
  fast: z.boolean(),
  level: thinkingLevelSchema,
});
export type VariantChoice = z.infer<typeof variantChoiceSchema>;

export const DEFAULT_CHOICE: VariantChoice = { fast: false, level: "default" };

const LEVEL_OF_EFFORT: Readonly<Record<Effort, ThinkingLevel>> = {
  high: "high",
  low: "low",
  medium: "medium",
  off: "off",
};

/** The family a model target belongs to, folded entries included. */
export const familyOf = (
  folded: FoldedModels,
  target: RunTarget
): ModelFamily | undefined => {
  if (target.type !== "model") {
    return;
  }
  const base = folded.baseOf.get(target.model) ?? target.model;
  return folded.families.get(base);
};

/** The choice a target stands for: which entry it runs, and at what effort. */
export const choiceOfTarget = (
  family: ModelFamily,
  target: RunTarget
): VariantChoice => {
  if (target.type !== "model") {
    return DEFAULT_CHOICE;
  }
  if (family.fast?.selector === target.model) {
    const effort = target.parameters?.reasoningEffort;
    return { fast: true, level: effort ? LEVEL_OF_EFFORT[effort] : "default" };
  }
  const variant = family.thinking.find(
    (each) => each.model.selector === target.model
  );
  if (variant) {
    return { fast: false, level: variant.level };
  }
  const effort = target.parameters?.reasoningEffort;
  return { fast: false, level: effort ? LEVEL_OF_EFFORT[effort] : "default" };
};

/**
 * The target for a family and a choice. Fast mode picks the fast entry; a
 * folded level picks its entry (unless fast mode is on); any other level
 * the contract can send rides along as `parameters.reasoningEffort`. A
 * level it can't send yet, or one the family doesn't offer, sends nothing,
 * so the provider's default applies.
 */
export const targetForChoice = (
  family: ModelFamily,
  vendor: string,
  choice: VariantChoice
): RunTarget => {
  const fast = choice.fast && family.fast?.available === true;
  const offered = thinkingLevels(family, vendor, fast)?.find(
    (each) => each.level === choice.level && each.blocked === undefined
  );
  const runs =
    offered?.model ?? (fast && family.fast ? family.fast : family.base);
  const effort =
    offered && offered.model === undefined && offered.level !== "default"
      ? EFFORTS[offered.level]
      : undefined;
  // "Off" for a family without provider levels is just the base model.
  const send =
    effort && providerLevels(family.base, vendor) ? effort : undefined;
  return {
    model: runs.selector,
    type: "model",
    ...(send ? { parameters: { reasoningEffort: send } } : {}),
  };
};
