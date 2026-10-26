import type { AnthropicLanguageModelOptions } from "@ai-sdk/anthropic";
import type {
  LanguageModelV4,
  SharedV4ProviderOptions,
} from "@ai-sdk/provider";
import type { ProviderType } from "@workspace/config/schema";
import type {
  ReasoningLevel,
  RunOptions,
} from "@workspace/contract/schemas/runs";
import { type LanguageModelCallOptions, wrapLanguageModel } from "ai";

import {
  type AnthropicAdaptive,
  anthropicAdaptive,
  defaultReasoningLevel,
  hasFastTier,
  type ModelIdentity,
  reasoningLevels,
} from "./reasoning";

// How a run's `reasoning` and `fast` options (105) reach the model: the
// AI SDK's portable `reasoning` call setting, which each provider maps to
// its own API, and the provider options for a fast tier. Anthropic's
// adaptive models are the exception: their thinking goes as provider
// options, always, so thinking shows (`display: summarized`) and a run
// without a level gets the level the composer shows.

/** What a run's options add to each model call. */
export interface RunSettings {
  readonly providerOptions?: SharedV4ProviderOptions;
  readonly reasoning?: NonNullable<LanguageModelCallOptions["reasoning"]>;
}

export interface RunSettingsInput extends ModelIdentity {
  readonly options: Pick<RunOptions, "fast" | "reasoning" | "reasoningEffort">;
  /** The configured provider's adapter. */
  readonly providerType: ProviderType;
  /**
   * Whether the provider's catalog says the model reasons; `undefined` when
   * no catalog says. An OpenAI-compatible server gets a level only on `true`.
   */
  readonly reasons: boolean | undefined;
}

const SDK_LEVEL: Readonly<
  Record<ReasoningLevel, NonNullable<LanguageModelCallOptions["reasoning"]>>
> = {
  high: "high",
  low: "low",
  // Never offered (see `reasoningLevels`); the nearest portable level.
  max: "xhigh",
  medium: "medium",
  minimal: "minimal",
  off: "none",
  xhigh: "xhigh",
};

const fastOptions = (
  providerType: ProviderType
): RunSettings["providerOptions"] => {
  switch (providerType) {
    case "openai":
      return { openai: { serviceTier: "priority" } };
    case "anthropic":
      return { anthropic: { speed: "fast" } };
    default:
      // Azure, Bedrock and Google have tiers of their own the SDK can't gate
      // per model; a gateway lists its fast models as `-fast` entries.
      return;
  }
};

// The SDK's own effort map for adaptive models; `off` is `disabled`.
const ADAPTIVE_EFFORT: Readonly<
  Record<
    Exclude<ReasoningLevel, "off">,
    NonNullable<AnthropicLanguageModelOptions["effort"]>
  >
> = {
  high: "high",
  low: "low",
  max: "max",
  medium: "medium",
  minimal: "low",
  xhigh: "xhigh",
};

const adaptiveThinking = (
  { xhigh }: AnthropicAdaptive,
  level: ReasoningLevel
): Pick<AnthropicLanguageModelOptions, "effort" | "thinking"> =>
  level === "off"
    ? { thinking: { type: "disabled" } }
    : {
        effort: level === "xhigh" ? xhigh : ADAPTIVE_EFFORT[level],
        thinking: { display: "summarized", type: "adaptive" },
      };

/**
 * The call settings a run's `reasoning` and `fast` make for this model. A
 * level the model doesn't take is dropped, not an error: the model's
 * default applies (`defaultReasoningLevel`, sent explicitly to Anthropic's
 * adaptive models). So is fast mode where the model has no fast tier.
 */
export const runSettings = ({
  modelId,
  options,
  providerType,
  reasons,
  vendor,
}: RunSettingsInput): RunSettings => {
  const identity = { modelId, vendor };
  const asked = options.reasoning ?? options.reasoningEffort;
  const takesLevels = providerType !== "openai-compatible" || reasons === true;
  const level =
    asked && takesLevels && reasoningLevels(identity).includes(asked)
      ? asked
      : undefined;
  const fast =
    options.fast === true && hasFastTier(identity)
      ? fastOptions(providerType)
      : undefined;
  const adaptive =
    providerType === "anthropic" ? anthropicAdaptive(modelId) : undefined;
  if (adaptive) {
    const thinking = adaptiveThinking(
      adaptive,
      level ?? defaultReasoningLevel(identity)
    );
    return {
      providerOptions: { anthropic: { ...thinking, ...fast?.anthropic } },
    };
  }
  return {
    ...(fast ? { providerOptions: fast } : {}),
    ...(level ? { reasoning: SDK_LEVEL[level] } : {}),
  };
};

/**
 * `model` with `settings` applied to every call: the level wins over a
 * preset's `reasoningEffort`, and the provider options merge over any the
 * call already has. The model itself when there's nothing to add.
 */
export const withRunSettings = (
  model: LanguageModelV4,
  settings: RunSettings
): LanguageModelV4 => {
  const { providerOptions, reasoning } = settings;
  if (!(providerOptions || reasoning)) {
    return model;
  }
  return wrapLanguageModel({
    middleware: {
      transformParams: ({ params }) =>
        Promise.resolve({
          ...params,
          ...(reasoning ? { reasoning } : {}),
          ...(providerOptions
            ? {
                providerOptions: mergeProviderOptions(
                  params.providerOptions,
                  providerOptions
                ),
              }
            : {}),
        }),
    },
    model,
  });
};

const mergeProviderOptions = (
  base: SharedV4ProviderOptions | undefined,
  extra: SharedV4ProviderOptions
): SharedV4ProviderOptions =>
  Object.fromEntries([
    ...Object.entries(base ?? {}),
    ...Object.entries(extra).map(
      ([key, value]) => [key, { ...base?.[key], ...value }] as const
    ),
  ]);
