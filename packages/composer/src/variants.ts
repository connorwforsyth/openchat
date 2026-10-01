import {
  defaultReasoningLevel,
  hasFastTier,
  reasoningLevels,
} from "@workspace/ai/providers/reasoning";
import {
  type ModelOption,
  parseModelRef,
} from "@workspace/contract/schemas/models";
import type {
  ReasoningLevel,
  RunOptions,
  RunTarget,
} from "@workspace/contract/schemas/runs";
import { z } from "zod";

// Thinking levels and fast mode (105). A catalog often lists a mode of a
// model as a model of its own (`o4-mini-high`, `claude-3.7-sonnet:thinking`,
// the gateway's `claude-opus-5-fast`). Those fold into the model they're a
// mode of, and come back as a thinking level or the fast switch. Pure, so
// the rules are tested without rendering anything.

/**
 * A thinking level. `on` is a folded `-thinking` entry, for a model whose
 * only choice is thinking or not. The rest are the run's `reasoning`
 * levels. There's no "default": the level the provider uses when nothing
 * is sent is shown as itself (113).
 */
export const thinkingLevelSchema = z.enum([
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

/** What a turn sends besides its target: the run's `reasoning` and `fast` (105). */
export type ModelVariant = Pick<RunOptions, "fast" | "reasoning">;

// Suffixes that name a mode of a model, not another model. `-mini`,
// `-nano`, sizes and versions are other models and never fold.
const THINKING_SUFFIXES: readonly (readonly [string, ThinkingLevel])[] = [
  [":thinking", "on"],
  ["-thinking", "on"],
  ["-reasoning", "on"],
  ["-high", "high"],
];
// `-highspeed` and `-ultraspeed` are the gateway's names for a fast tier.
const FAST_SUFFIXES: readonly string[] = [
  "-fast",
  "-highspeed",
  "-ultraspeed",
  "-instant",
  "-turbo",
];

export interface ThinkingVariant {
  readonly level: ThinkingLevel;
  readonly model: ModelOption;
}

/** A model with the entries that are only a mode of it. */
export interface ModelFamily {
  readonly base: ModelOption;
  /** A folded fast entry (`-fast`, `-highspeed`, `-ultraspeed`, `-instant`, `-turbo`). */
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

// ---- What each provider takes ----

/** A model's maker-facing id, for the shared tables. */
const identity = (model: ModelOption, vendor: string) => ({
  modelId: parseModelRef(model.target ?? model.selector)?.modelId ?? "",
  vendor,
});

/**
 * The thinking levels a reasoning model's provider takes, from the tables
 * the server sends them by (`@workspace/ai/providers/reasoning`).
 * `undefined` for a model the server doesn't say reasons.
 */
export const providerLevels = (
  model: ModelOption,
  vendor: string
): readonly ReasoningLevel[] | undefined =>
  model.capabilities.includes("reasoning")
    ? reasoningLevels(identity(model, vendor))
    : undefined;

/**
 * The level the provider uses for a reasoning model when the run sends no
 * `reasoning` (113); `undefined` for a model the server doesn't say reasons.
 */
export const providerDefaultLevel = (
  model: ModelOption,
  vendor: string
): ReasoningLevel | undefined =>
  model.capabilities.includes("reasoning")
    ? defaultReasoningLevel(identity(model, vendor))
    : undefined;

/**
 * Whether the model's maker has a fast tier for it (OpenAI priority,
 * Anthropic fast mode), billed at a higher rate.
 */
export const providerFastTier = (model: ModelOption, vendor: string): boolean =>
  hasFastTier(identity(model, vendor));

// ---- The choices ----

/**
 * Why a choice can't be made: it's a folded entry while fast mode is on,
 * the host doesn't send run options, or there's no key for it here.
 */
export type LevelBlock = "fast" | "server" | "unavailable";

export interface LevelChoice {
  readonly blocked?: LevelBlock;
  /**
   * What the model does with nothing sent: the provider's default level,
   * or the base model when its thinking is a catalog entry. Choosing it
   * sends no `reasoning`, so it's never blocked.
   */
  readonly default?: true;
  readonly level: ThinkingLevel;
  /** The model this level runs, when it's a folded entry of its own. */
  readonly model?: ModelOption;
}

/** Fast mode for a family: a folded fast entry, else the provider's tier. */
export interface FastMode {
  /** Why it can't be switched on, if it can't. */
  readonly blocked?: Exclude<LevelBlock, "fast">;
  /** The folded entry fast mode picks; absent for a provider tier. */
  readonly model?: ModelOption;
}

/**
 * The family's fast mode, or `undefined` when it has none. `sends` says
 * whether the host sends run options; without them a provider tier can't
 * be asked for.
 */
export const fastMode = (
  family: ModelFamily,
  vendor: string,
  sends: boolean
): FastMode | undefined => {
  if (family.fast) {
    return family.fast.available
      ? { model: family.fast }
      : { blocked: "unavailable", model: family.fast };
  }
  if (!providerFastTier(family.base, vendor)) {
    return;
  }
  return sends ? {} : { blocked: "server" };
};

const LEVEL_ORDER = thinkingLevelSchema.options;

const byLevel = (a: LevelChoice, b: LevelChoice): number =>
  LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level);

const usableFast = (family: ModelFamily, fast: boolean): boolean =>
  fast && family.fast?.available === true;

/**
 * The thinking levels to offer for a family, or `undefined` when there's
 * no choice to make (a model that doesn't reason, with no thinking entry).
 * A folded entry is the level that picks it and wins over the provider's
 * level of the same name. While a folded fast entry is on, the folded
 * levels can't be had: they're other models. Without run options from the
 * host, the provider's own levels can't be sent.
 */
export const thinkingLevels = (
  family: ModelFamily,
  vendor: string,
  fast: boolean,
  sends: boolean
): readonly LevelChoice[] | undefined => {
  const provider = providerLevels(family.base, vendor);
  if (provider === undefined && family.thinking.length === 0) {
    return;
  }
  const fastOn = usableFast(family, fast);
  const folded = family.thinking.map((variant): LevelChoice => {
    let blocked: LevelBlock | undefined;
    if (fastOn) {
      blocked = "fast";
    } else if (!variant.model.available) {
      blocked = "unavailable";
    }
    return {
      level: variant.level,
      model: variant.model,
      ...(blocked ? { blocked } : {}),
    };
  });
  const fallback = providerDefaultLevel(family.base, vendor);
  const own = (provider ?? []).flatMap((level): LevelChoice[] => {
    if (level === fallback) {
      return [{ default: true, level }];
    }
    return folded.some((variant) => variant.level === level)
      ? []
      : [{ level, ...(sends ? {} : { blocked: "server" as const }) }];
  });
  // Without provider levels, the base model is the "off" choice.
  const base: LevelChoice[] =
    provider === undefined ? [{ default: true, level: "off" }] : [];
  const kept = folded.filter((variant) => variant.level !== fallback);
  return [...base, ...own, ...kept].sort(byLevel);
};

/**
 * What the person chose for a model: fast mode, and a thinking level if
 * they picked one (none means the provider's default). A level remembered
 * as `default` before 113 reads as none.
 */
export const variantChoiceSchema = z.object({
  fast: z.boolean(),
  level: z.preprocess(
    (level) => (level === "default" ? undefined : level),
    thinkingLevelSchema.optional()
  ),
});
export type VariantChoice = z.infer<typeof variantChoiceSchema>;

export const DEFAULT_CHOICE: VariantChoice = { fast: false };

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

/** The choice a target and the run options stand for. */
export const choiceOfTarget = (
  family: ModelFamily,
  target: RunTarget,
  variant: ModelVariant
): VariantChoice => {
  if (target.type !== "model") {
    return DEFAULT_CHOICE;
  }
  const folded = family.thinking.find(
    (each) => each.model.selector === target.model
  );
  const level = folded?.level ?? variant.reasoning;
  return {
    fast: family.fast?.selector === target.model || variant.fast === true,
    ...(level ? { level } : {}),
  };
};

/** A turn's target and the run options that go with it. */
export interface VariantTarget {
  readonly target: RunTarget;
  readonly variant: ModelVariant;
}

/**
 * The target and run options for a family and a choice. Fast mode picks
 * the folded fast entry, else asks for the provider's tier; a folded level
 * picks its entry (unless that fast entry is on); a provider level goes
 * out as the run's `reasoning`. A choice the family doesn't offer, or
 * can't send, sends nothing, so the provider's default applies.
 */
export const targetForChoice = (
  family: ModelFamily,
  vendor: string,
  choice: VariantChoice,
  sends: boolean
): VariantTarget => {
  const fastEntry = usableFast(family, choice.fast);
  const offered = thinkingLevels(family, vendor, choice.fast, sends)?.find(
    (each) => each.level === choice.level && each.blocked === undefined
  );
  const runs =
    offered?.model ?? (fastEntry && family.fast ? family.fast : family.base);
  const fast = fastMode(family, vendor, sends);
  const tier =
    choice.fast && fast !== undefined && !fast.model && !fast.blocked;
  // The provider's default goes out as nothing, so it stays the provider's.
  const reasoning =
    offered &&
    !(offered.model || offered.default) &&
    providerLevels(family.base, vendor)
      ? reasoningOf(offered.level)
      : undefined;
  return {
    target: { model: runs.selector, type: "model" },
    variant: {
      ...(tier ? { fast: true } : {}),
      ...(reasoning ? { reasoning } : {}),
    },
  };
};

const reasoningOf = (level: ThinkingLevel): ReasoningLevel | undefined =>
  level === "on" ? undefined : level;
