import {
  type ModelRef,
  modelRefSchema,
  type TokenUsage,
} from "@workspace/contract/schemas/models";

import { priceSnapshotSchema, type SnapshotSource } from "./models-dev";
import snapshotJson from "./models-dev.snapshot.json";
import type { AppConfig, ProviderConfig } from "./schema";

// What a model call cost, from its token usage and the instance's prices.
// Pure, and here rather than in the server so anything holding a parsed config
// (the run recorder, the model proxy, eval runs and reports) prices a call the
// same way.
//
// Prices are integer micro-USD per million tokens and the sum is done in
// BigInt, so nothing is ever a fraction until the one division at the end.

export type ModelPrices = AppConfig["models"]["prices"];

const snapshot = priceSnapshotSchema.parse(snapshotJson);

/** Where a configured provider's list prices live in the snapshot, if anywhere. */
const GATEWAY_HOSTS: Readonly<Record<string, SnapshotSource>> = {
  "ai-gateway.vercel.sh": "vercel",
};

export const snapshotSourceOf = (
  provider: ProviderConfig
): SnapshotSource | undefined => {
  switch (provider.type) {
    case "anthropic":
    case "google":
    case "openai":
      return provider.type;
    case "openai-compatible":
      return provider.baseURL === undefined
        ? undefined
        : GATEWAY_HOSTS[new URL(provider.baseURL).hostname];
    // Azure and Bedrock name deployments, not models, and Ollama is local.
    case "azure":
    case "bedrock":
      return;
    default:
      return provider.type satisfies never;
  }
};

/**
 * Every price the instance charges at: models.dev's list price for each
 * configured provider's models, under that provider's own id, with
 * `models.prices` winning wherever the operator set one. A model in neither
 * is unpriced.
 */
export const effectivePrices = (
  config: Pick<AppConfig, "models"> & Partial<Pick<AppConfig, "providers">>
): ModelPrices => {
  const listed = Object.entries(config.providers ?? {}).flatMap(
    ([id, provider]) => {
      const source = snapshotSourceOf(provider);
      return source === undefined
        ? []
        : Object.entries(snapshot.prices[source])
            .map(([model, price]) => [`${id}:${model}`, price] as const)
            .filter(([ref]) => modelRefSchema.safeParse(ref).success);
    }
  );
  return { ...Object.fromEntries(listed), ...config.models.prices };
};

export type UsageCost =
  | { readonly costMicros: number; readonly priced: true }
  /** Neither the operator nor the snapshot prices the model: cost 0, which isn't the same as free. */
  | { readonly costMicros: 0; readonly priced: false };

const TOKENS_PER_PRICE = 1_000_000n;
const HALF = TOKENS_PER_PRICE / 2n;
const MAX_COST = BigInt(Number.MAX_SAFE_INTEGER);

/** A token count as the providers should send it; anything else counts as none. */
const tokens = (count: number | undefined): bigint =>
  count !== undefined && Number.isFinite(count) && count > 0
    ? BigInt(Math.trunc(count))
    : 0n;

/**
 * The cost of `usage` on `model`, in micro-USD.
 *
 * - `inputTokens` includes the cached ones, so cached tokens are charged at
 *   `cachedInputMicros` (or the input price when there's none) and only the
 *   rest at `inputMicros`. A provider claiming more cached than input tokens
 *   is charged for the input it reported.
 * - `outputTokens` includes reasoning tokens; they aren't charged twice.
 * - The three products are summed exactly, then divided by a million and
 *   rounded half up to a whole micro-USD, once per call. The result never
 *   exceeds `Number.MAX_SAFE_INTEGER`.
 */
export const usageCost = (
  prices: ModelPrices,
  model: ModelRef,
  usage: TokenUsage
): UsageCost => {
  const price = Object.hasOwn(prices, model) ? prices[model] : undefined;
  if (!price) {
    return { costMicros: 0, priced: false };
  }
  // An image model priced per image may leave its tokens unpriced.
  const inputMicros = price.inputMicros ?? 0;
  const input = tokens(usage.inputTokens);
  const reported = tokens(usage.cachedInputTokens);
  const cached = reported > input ? input : reported;
  const millionths =
    (input - cached) * BigInt(inputMicros) +
    cached * BigInt(price.cachedInputMicros ?? inputMicros) +
    tokens(usage.outputTokens) * BigInt(price.outputMicros ?? 0);
  const micros = (millionths + HALF) / TOKENS_PER_PRICE;
  return {
    costMicros: Number(micros > MAX_COST ? MAX_COST : micros),
    priced: true,
  };
};

/**
 * What `count` images from an image model cost (138): `imageMicros` each,
 * plus their tokens at the model's token prices where the provider reports
 * them (OpenAI's image models bill by token). Unpriced, like `usageCost`,
 * when `prices` doesn't list the model.
 */
export const imageCost = (
  prices: ModelPrices,
  model: ModelRef,
  count: number,
  usage: TokenUsage = { inputTokens: 0, outputTokens: 0 }
): UsageCost => {
  const price = Object.hasOwn(prices, model) ? prices[model] : undefined;
  if (!price) {
    return { costMicros: 0, priced: false };
  }
  const perImage = BigInt(price.imageMicros ?? 0) * tokens(count);
  const total = BigInt(usageCost(prices, model, usage).costMicros) + perImage;
  return {
    costMicros: Number(total > MAX_COST ? MAX_COST : total),
    priced: true,
  };
};
