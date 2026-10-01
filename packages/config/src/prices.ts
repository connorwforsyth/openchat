import type { ModelRef, TokenUsage } from "@workspace/contract/schemas/models";

import type { AppConfig } from "./schema";

// What a model call cost, from its token usage and `models.prices`. Pure, and
// here rather than in the server so anything holding a parsed config (the run
// recorder, the model proxy, eval runs and reports) prices a call the same way.
//
// Prices are integer micro-USD per million tokens and the sum is done in
// BigInt, so nothing is ever a fraction until the one division at the end.

export type ModelPrices = AppConfig["models"]["prices"];

export type UsageCost =
  | { readonly costMicros: number; readonly priced: true }
  /** No price is configured for the model: cost 0, which isn't the same as free. */
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
  const input = tokens(usage.inputTokens);
  const reported = tokens(usage.cachedInputTokens);
  const cached = reported > input ? input : reported;
  const millionths =
    (input - cached) * BigInt(price.inputMicros) +
    cached * BigInt(price.cachedInputMicros ?? price.inputMicros) +
    tokens(usage.outputTokens) * BigInt(price.outputMicros);
  const micros = (millionths + HALF) / TOKENS_PER_PRICE;
  return {
    costMicros: Number(micros > MAX_COST ? MAX_COST : micros),
    priced: true,
  };
};
