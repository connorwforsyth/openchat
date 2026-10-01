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

// Anthropic: models the SDK sends adaptive thinking with an effort to (they
// take xhigh); the rest get a token budget that low/medium/high scale.
const ANTHROPIC_ADAPTIVE = /claude-(opus|sonnet|fable)-(4-[6-9]|[5-9])/;
// Anthropic models that always think: the SDK turns "none" into low effort.
const ANTHROPIC_ALWAYS_THINKS = /claude-(opus-5-5|fable-5)/;
const OPENAI_O_SERIES = /^o\d/;
const OPENAI_GPT = /^gpt-(\d+)(?:-(\d+))?/;
const OPENAI_GPT6_NONE = /^gpt-6-(sol|luna)/;
const GEMINI_2 = /^gemini-(1|2)-/;
const GEMINI_25_PRO = /^gemini-2-5-pro/;

const anthropicLevels = (id: string): readonly ReasoningLevel[] => [
  ...(ANTHROPIC_ALWAYS_THINKS.test(id) ? [] : (["off"] as const)),
  "low",
  "medium",
  "high",
  ...(ANTHROPIC_ADAPTIVE.test(id) ? (["xhigh"] as const) : []),
];

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
 * - Anthropic: off (except models that always think), low, medium, high;
 *   adaptive models (4.6 on, 5.x) also xhigh.
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
// Anthropic: thinking is off unless asked for, except on models that always
// think (effort defaults to medium on Opus 5.5, high elsewhere) and Sonnet
// 5, which thinks by default (the SDK sends `disabled` for that reason).
const ANTHROPIC_DEFAULT_MEDIUM = /claude-opus-5-5/;
const ANTHROPIC_THINKS_BY_DEFAULT = /claude-sonnet-5/;
// OpenAI: `medium` (the SDK's documented default), except GPT-5.1 and
// GPT-5.2, which OpenAI documents as defaulting to `none` (their Codex
// models keep medium).
const OPENAI_DEFAULT_NONE = /^gpt-5-[12](?!\d)(?!.*codex)/;
// Gemini 2.5 Flash-Lite doesn't think unless asked; the rest of 2.5 think
// dynamically, nearest a medium budget. Gemini 3 defaults to `high`.
const GEMINI_FLASH_LITE = /^gemini-2-5-flash-lite/;

const anthropicDefault = (id: string): ReasoningLevel => {
  if (ANTHROPIC_DEFAULT_MEDIUM.test(id)) {
    return "medium";
  }
  return ANTHROPIC_ALWAYS_THINKS.test(id) ||
    ANTHROPIC_THINKS_BY_DEFAULT.test(id)
    ? "high"
    : "off";
};

const googleDefault = (id: string): ReasoningLevel => {
  if (GEMINI_2.test(id)) {
    return GEMINI_FLASH_LITE.test(id) ? "off" : "medium";
  }
  return "high";
};

const preferredDefault = (vendor: string, id: string): ReasoningLevel => {
  switch (vendor) {
    case "anthropic":
      return anthropicDefault(id);
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
