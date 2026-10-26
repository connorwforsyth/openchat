import { z } from "zod";

// Models are named two ways, and the UI never hard-codes a provider (D3):
// - a model ref, `provider:modelId` (`anthropic:claude-opus-5-5`), where the
//   provider is a key under `providers:` in app.config.yaml;
// - an alias from `models.aliases` (`fast`, `strong`), or the reserved `auto`
//   which asks the Decider to route each turn.

const PROVIDER_ID = /^[a-z][a-z0-9_-]{0,63}$/;
const MODEL_REF = /^[a-z][a-z0-9_-]{0,63}:[^\s:][^\s]{0,255}$/;
const MODEL_ALIAS = /^[a-z][a-z0-9_-]{0,63}$/;

export const providerIdSchema = z
  .string()
  .regex(PROVIDER_ID, "lowercase provider id, like `anthropic`");
export type ProviderId = z.infer<typeof providerIdSchema>;

export const modelRefSchema = z
  .string()
  .regex(MODEL_REF, "`provider:modelId`, like `anthropic:claude-opus-5-5`");
export type ModelRef = z.infer<typeof modelRefSchema>;

export const AUTO_MODEL = "auto";

export const modelAliasSchema = z
  .string()
  .regex(MODEL_ALIAS, "lowercase alias, like `fast`");

/** What a user or agent picks: a ref, an alias, or `auto`. */
export const modelSelectorSchema = z.union([modelRefSchema, modelAliasSchema]);
export type ModelSelector = z.infer<typeof modelSelectorSchema>;

/** Splits a ref into its parts; `undefined` for an alias. */
export const parseModelRef = (
  selector: string
): { readonly modelId: string; readonly provider: string } | undefined => {
  if (!MODEL_REF.test(selector)) {
    return;
  }
  const index = selector.indexOf(":");
  return {
    modelId: selector.slice(index + 1),
    provider: selector.slice(0, index),
  };
};

/** Call parameters a preset or agent version may set. All optional; the provider's defaults apply. */
export const modelParametersSchema = z.object({
  frequencyPenalty: z.number().min(-2).max(2).optional(),
  maxOutputTokens: z.int().min(1).optional(),
  presencePenalty: z.number().min(-2).max(2).optional(),
  reasoningEffort: z.enum(["off", "low", "medium", "high"]).optional(),
  seed: z.int().optional(),
  stopSequences: z.array(z.string()).max(8).optional(),
  temperature: z.number().min(0).max(2).optional(),
  topK: z.int().min(1).optional(),
  topP: z.number().min(0).max(1).optional(),
});
export type ModelParameters = z.infer<typeof modelParametersSchema>;

export const tokenUsageSchema = z.object({
  cachedInputTokens: z.int().min(0).optional(),
  inputTokens: z.int().min(0),
  outputTokens: z.int().min(0),
  reasoningTokens: z.int().min(0).optional(),
});
export type TokenUsage = z.infer<typeof tokenUsageSchema>;

export const modelCapabilitySchema = z.enum([
  "tools",
  "vision",
  "files",
  "reasoning",
  "web-search",
  /** Writes images in its own reply, as the provider's catalog says (138). */
  "image-output",
]);

/** A 1–5 step on the picker's bars: 1 is the least (slowest, cheapest), 5 the most. */
export const modelTierSchema = z.int().min(1).max(5);

/**
 * What a model costs (099): a tier for the bar, and the prices it came from
 * when the provider's catalog lists them, in micro-USD per million tokens
 * (`3_000_000` is $3 per million).
 */
export const modelCostSchema = z.object({
  input: z.int().min(0).optional(),
  output: z.int().min(0).optional(),
  tier: modelTierSchema,
});
export type ModelCost = z.infer<typeof modelCostSchema>;

/** How fast and how capable a model is, as the instance's config rates it (099). */
export const modelRatingsSchema = z.object({
  intelligence: modelTierSchema.optional(),
  speed: modelTierSchema.optional(),
});
export type ModelRatings = z.infer<typeof modelRatingsSchema>;

/** A model offered in the picker for the caller's current context. */
export const modelOptionSchema = z.object({
  /** Whether a key is available in this context (D17); unavailable ones show disabled. */
  available: z.boolean(),
  /** What it can do, as far as the provider or its catalog says. */
  capabilities: z.array(modelCapabilitySchema),
  contextWindow: z.int().min(1).nullable(),
  /** Absent when no price is known (099). */
  cost: modelCostSchema.optional(),
  /**
   * One short line on why you'd pick it (096): the config's, else the
   * provider catalog's. Absent when neither says; `auto`'s is the UI's own.
   */
  description: z.string().optional(),
  /**
   * The model's name as people say it (099), without a vendor prefix: the
   * provider catalog's (`Claude Opus 4`), else tidied from the model id.
   * Absent for `auto`.
   */
  displayName: z.string().min(1).optional(),
  /**
   * The image model `generate_image` uses when this model asks for a
   * picture in this context (138); absent when there is none, or the model
   * can't call tools.
   */
  imageModel: z
    .object({ displayName: z.string().min(1), target: modelRefSchema })
    .optional(),
  /** The label shown in the picker. */
  label: z.string(),
  /**
   * Who makes the model, for grouping and its mark (096): the vendor an
   * aggregator ref names (`gateway:anthropic/…` is `anthropic`), else the
   * ref's provider. Absent for `auto`.
   */
  provider: providerIdSchema.optional(),
  /**
   * The picker's bars (099), field by field: the config's `models.ratings`
   * (the alias's, else the ref's), else the repo's committed model catalogue
   * (speed from Gateway throughput, intelligence from a curated list). A
   * field neither covers is absent.
   */
  ratings: modelRatingsSchema.optional(),
  /** What to send back: the alias if there is one, else the ref. */
  selector: modelSelectorSchema,
  /** The ref an alias resolves to; `null` for `auto`. */
  target: modelRefSchema.nullable(),
});
export type ModelOption = z.infer<typeof modelOptionSchema>;
