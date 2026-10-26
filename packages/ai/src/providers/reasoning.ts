import {
  type ModelRef,
  parseModelRef,
} from "@workspace/contract/schemas/models";
import {
  type ReasoningLevel,
  reasoningLevelSchema,
} from "@workspace/contract/schemas/runs";

import { vendorOf } from "./describe";

// Thinking levels and fast tiers (105): which a model takes, and how a run's
// `reasoning` and `fast` options reach its provider. The tables follow the
// installed AI SDK providers, which map the portable `reasoning` call
// setting to each API (a thinking budget or effort for Anthropic,
// `reasoningEffort` for OpenAI, `thinkingConfig` for Gemini, and
// `reasoning_effort` passed as is for an OpenAI-compatible server). Pure and
// dependency-free, so the composer reads the same tables and the picker
// offers exactly what the server sends (`run-settings.ts` sends it).

/** Who makes a model and its id, without provider or vendor prefix. */
export interface ModelIdentity {
  /** The model id, like `claude-opus-5-5` or `anthropic/claude-opus-5.5`. */
  readonly modelId: string;
  /** Who makes it (`anthropic`), as `ModelOption.provider` names it. */
  readonly vendor: string;
}

/** A ref's model id and maker, as `ModelOption.provider` names it. */
export const identityOf = (ref: ModelRef): ModelIdentity => ({
  modelId: parseModelRef(ref)?.modelId ?? ref,
  vendor: vendorOf(ref) ?? "",
});

const VENDOR_PREFIX = /^[^/]+\//;

/** The id without a vendor prefix, lowercased, dots as dashes. */
export const bareModelId = (modelId: string): string =>
  modelId.replace(VENDOR_PREFIX, "").toLowerCase().replaceAll(".", "-");

// Anthropic models with adaptive thinking, newest first (first match wins).
// Facts from Anthropic's model docs: whether `thinking: disabled` is accepted
// (at effort high or below), and what the model does with nothing sent. Their
// thinking goes out as provider options (`run-settings.ts`), since the SDK
// guesses at ids it doesn't know and leaves `display` at the API's default,
// which is `omitted` (empty thinking text) on every 4.7-and-later model.
export interface AnthropicAdaptive {
  readonly canDisable: boolean;
  /** The level a run without one gets; the composer shows it as the default. */
  readonly defaultLevel: ReasoningLevel;
  readonly match: RegExp;
  /** The effort `xhigh` sends: 4.6 has no xhigh, so it gets max. */
  readonly xhigh: "max" | "xhigh";
}

const ANTHROPIC_ADAPTIVE: readonly AnthropicAdaptive[] = [
  // Effort defaults to medium; thinking can't be turned off.
  {
    canDisable: false,
    defaultLevel: "medium",
    match: /claude-opus-5-5/,
    xhigh: "xhigh",
  },
  // `disabled` is a 400 (only `between_tools` turns it off); effort high.
  {
    canDisable: false,
    defaultLevel: "high",
    match: /claude-sonnet-5-5/,
    xhigh: "xhigh",
  },
  // Thinks at medium by default. Not low: at low it skips thinking on
  // everyday prompts, so there's nothing to show.
  {
    canDisable: true,
    defaultLevel: "medium",
    match: /claude-haiku-5-5/,
    xhigh: "xhigh",
  },
  {
    canDisable: false,
    defaultLevel: "high",
    match: /claude-fable-5/,
    xhigh: "xhigh",
  },
  // Opus 5 and Sonnet 5 think by default at high.
  {
    canDisable: true,
    defaultLevel: "high",
    match: /claude-(opus|sonnet)-5/,
    xhigh: "xhigh",
  },
  // Opus 4.7 and 4.8 don't think unless asked.
  {
    canDisable: true,
    defaultLevel: "off",
    match: /claude-opus-4-[78]/,
    xhigh: "xhigh",
  },
  {
    canDisable: true,
    defaultLevel: "off",
    match: /claude-(opus|sonnet)-4-6/,
    xhigh: "max",
  },
  // Later Opus, Sonnet and Fable ids than these, until they get rows of
  // their own: adaptive, with xhigh. Turning thinking off is a 400 on the
  // newest ones, so it isn't offered.
  {
    canDisable: false,
    defaultLevel: "medium",
    match: /claude-(opus|sonnet|fable)-([6-9]|\d{2,})/,
    xhigh: "xhigh",
  },
];

/** The adaptive-thinking row for an Anthropic model id, if it has one. */
export const anthropicAdaptive = (
  modelId: string
): AnthropicAdaptive | undefined => {
  const id = bareModelId(modelId);
  return ANTHROPIC_ADAPTIVE.find(({ match }) => match.test(id));
};

const OPENAI_O_SERIES = /^o\d/;
const OPENAI_GPT = /^gpt-(\d+)(?:-(\d+))?/;
const OPENAI_GPT6_NONE = /^gpt-6-(sol|luna)/;
const GEMINI_2 = /^gemini-(1|2)-/;
const GEMINI_25_PRO = /^gemini-2-5-pro/;

// Models outside the adaptive table take a token budget that
// low/medium/high scale.
const anthropicLevels = (id: string): readonly ReasoningLevel[] => {
  const adaptive = anthropicAdaptive(id);
  return [
    ...(adaptive?.canDisable === false ? [] : (["off"] as const)),
    "low",
    "medium",
    "high",
    ...(adaptive ? (["xhigh"] as const) : []),
  ];
};

const openaiLevels = (id: string): readonly ReasoningLevel[] => {
  if (!(OPENAI_O_SERIES.test(id) || OPENAI_GPT.test(id))) {
    return ["low", "medium", "high"];
  }
  const gpt = OPENAI_GPT.exec(id);
  const major = gpt ? Number(gpt[1]) : 0;
  const minor = gpt?.[2];
  // `none` exists from GPT-5.1 on; GPT-6 takes it only on sol and luna.
  const off =
    (major === 5 && minor !== undefined) ||
    (major >= 6 && OPENAI_GPT6_NONE.test(id));
  return [
    ...(off ? (["off"] as const) : []),
    ...(major === 5 && minor === undefined ? (["minimal"] as const) : []),
    "low",
    "medium",
    "high",
    ...(major >= 6 ? (["xhigh"] as const) : []),
  ];
};

const googleLevels = (id: string): readonly ReasoningLevel[] => {
  if (GEMINI_2.test(id)) {
    // A thinking budget; only 2.5 Pro can't turn it down to nothing.
    return [
      ...(GEMINI_25_PRO.test(id) ? [] : (["off"] as const)),
      "low",
      "medium",
      "high",
    ];
  }
  // Gemini 3 thinks at a level; its lowest is minimal, never none.
  return ["minimal", "low", "medium", "high"];
};

/**
 * The thinking levels a reasoning model takes, lowest first. Whether it
 * reasons at all is the caller's to know (`capabilities`, the catalog):
 *
 * - Anthropic: off (except adaptive models that can't turn thinking off),
 *   low, medium, high; adaptive models (4.6 on, 5.x) also xhigh.
 * - OpenAI: low, medium, high; off from GPT-5.1; minimal on GPT-5; xhigh
 *   on GPT-6.
 * - Google: Gemini 2.5's budget (off, except 2.5 Pro), or Gemini 3's level
 *   (minimal to high).
 * - DeepSeek: off, low, high (its medium is high).
 * - Anyone else: low, medium, high, OpenAI's `reasoning_effort` convention.
 *
 * Keyed by who makes the model, since a gateway or Bedrock hands the same
 * setting to the maker's API. Max effort isn't portable (the SDK's
 * `reasoning` stops at xhigh), so it isn't offered.
 */
export const reasoningLevels = ({
  modelId,
  vendor,
}: ModelIdentity): readonly ReasoningLevel[] => {
  const id = bareModelId(modelId);
  switch (vendor) {
    case "anthropic":
      return anthropicLevels(id);
    case "openai":
      return openaiLevels(id);
    case "google":
      return googleLevels(id);
    case "deepseek":
      return ["off", "low", "high"];
    default:
      return ["low", "medium", "high"];
  }
};

// What a model does with no `reasoning` sent, from the installed SDK
// providers' docs and the makers' own (113). The composer shows it as the
// level in use until someone picks another, and picking it sends nothing.
// Anthropic: the adaptive table's default, which the server sends; older
// models think only when asked.
// OpenAI: `medium` (the SDK's documented default), except GPT-5.1 and
// GPT-5.2, which OpenAI documents as defaulting to `none` (their Codex
// models keep medium).
const OPENAI_DEFAULT_NONE = /^gpt-5-[12](?!\d)(?!.*codex)/;
// Gemini 2.5 Flash-Lite doesn't think unless asked; the rest of 2.5 think
// dynamically, nearest a medium budget. Gemini 3 defaults to `high`.
const GEMINI_FLASH_LITE = /^gemini-2-5-flash-lite/;

const googleDefault = (id: string): ReasoningLevel => {
  if (GEMINI_2.test(id)) {
    return GEMINI_FLASH_LITE.test(id) ? "off" : "medium";
  }
  return "high";
};

const preferredDefault = (vendor: string, id: string): ReasoningLevel => {
  switch (vendor) {
    case "anthropic":
      return anthropicAdaptive(id)?.defaultLevel ?? "off";
    case "openai":
      return OPENAI_DEFAULT_NONE.test(id) ? "off" : "medium";
    case "google":
      return googleDefault(id);
    case "deepseek":
      return "high";
    default:
      // OpenAI's `reasoning_effort` convention, which defaults to medium.
      return "medium";
  }
};

const LEVEL_ORDER = reasoningLevelSchema.options;

/**
 * The level a reasoning model thinks at when the run sends no `reasoning`:
 * the provider's own default, as one of `reasoningLevels` (the nearest one
 * when the default isn't a level it lists).
 */
export const defaultReasoningLevel = (
  identity: ModelIdentity
): ReasoningLevel => {
  const levels = reasoningLevels(identity);
  const wanted = preferredDefault(
    identity.vendor,
    bareModelId(identity.modelId)
  );
  if (levels.includes(wanted)) {
    return wanted;
  }
  const at = LEVEL_ORDER.indexOf(wanted);
  const distance = (level: ReasoningLevel) =>
    Math.abs(LEVEL_ORDER.indexOf(level) - at);
  return levels.reduce((best, level) =>
    distance(level) < distance(best) ? level : best
  );
};

// OpenAI models the SDK sends `serviceTier: "priority"` for (its
// `supportsPriorityProcessing`): GPT-4 and up, o3 and up, not nano or chat.
const OPENAI_PRIORITY = /^(gpt-4|o([3-9]|\d{2}))/;
const OPENAI_NO_PRIORITY = /-(nano|chat)/;
// Anthropic documents `speed: "fast"` for Opus 4.6.
const ANTHROPIC_FAST = /claude-opus-4-6/;

/**
 * Whether the maker has a fast tier for the model: OpenAI's priority
 * processing, Anthropic's fast mode. Both are billed at a higher rate.
 */
export const hasFastTier = ({ modelId, vendor }: ModelIdentity): boolean => {
  const id = bareModelId(modelId);
  switch (vendor) {
    case "openai": {
      const gpt = OPENAI_GPT.exec(id);
      return (
        (OPENAI_PRIORITY.test(id) || (gpt !== null && Number(gpt[1]) >= 5)) &&
        !OPENAI_NO_PRIORITY.test(id)
      );
    }
    case "anthropic":
      return ANTHROPIC_FAST.test(id);
    default:
      return false;
  }
};
