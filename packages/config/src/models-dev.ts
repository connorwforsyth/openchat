import { z } from "zod";

import { modelPriceSchema } from "./schema";

// List prices from models.dev (https://models.dev, MIT, Copyright (c) 2025
// models.dev), kept as a committed snapshot so pricing never needs the
// network. `scripts/refresh-prices.ts` rewrites the snapshot; this file is
// the pure half: the upstream shape we read and how it becomes our prices.

export const MODELS_DEV_URL = "https://models.dev/api.json";

/**
 * The models.dev providers we price. A configured provider maps to one of
 * them by its type, or by its base URL for an OpenAI-compatible gateway.
 */
export const snapshotSourceSchema = z.enum([
  "anthropic",
  "google",
  "openai",
  "vercel",
]);
export type SnapshotSource = z.infer<typeof snapshotSourceSchema>;

export const priceSnapshotSchema = z.strictObject({
  fetchedAt: z.iso.datetime(),
  /** Prices by source, then by the model id that source's API takes. */
  prices: z.record(
    snapshotSourceSchema,
    z.record(z.string().min(1), modelPriceSchema)
  ),
  source: z.literal(MODELS_DEV_URL),
});
export type PriceSnapshot = z.infer<typeof priceSnapshotSchema>;

/** USD per million tokens. */
const usdSchema = z.number().min(0);

/** The part of models.dev's `api.json` we read; the rest is ignored. */
const upstreamProviderSchema = z.object({
  models: z.record(
    z.string(),
    z.object({
      cost: z
        .object({
          cache_read: usdSchema.optional(),
          input: usdSchema,
          output: usdSchema,
        })
        .optional(),
    })
  ),
});

export const modelsDevSchema = z.object(
  Object.fromEntries(
    snapshotSourceSchema.options.map((source) => [
      source,
      upstreamProviderSchema,
    ])
  ) as Record<SnapshotSource, typeof upstreamProviderSchema>
);

const micros = (usd: number): number => Math.round(usd * 1_000_000);

const byKey = <T>(entries: [string, T][]): Record<string, T> =>
  Object.fromEntries(entries.sort(([a], [b]) => (a < b ? -1 : 1)));

/**
 * Our snapshot from models.dev's catalog: integer micro-USD per million
 * tokens, models without a price left out, keys sorted so a refresh diffs
 * cleanly. Cache writes and long-context tiers aren't kept: the usage we
 * record has no cache-write count, and a run's tokens are summed over its
 * steps, so no single call's context size is known.
 */
export const snapshotFromModelsDev = (
  catalog: z.infer<typeof modelsDevSchema>,
  fetchedAt: string
): PriceSnapshot => ({
  fetchedAt,
  prices: Object.fromEntries(
    snapshotSourceSchema.options.map((source) => [
      source,
      byKey(
        Object.entries(catalog[source].models).flatMap(([id, { cost }]) =>
          cost
            ? [
                [
                  id,
                  {
                    ...(cost.cache_read === undefined
                      ? {}
                      : { cachedInputMicros: micros(cost.cache_read) }),
                    inputMicros: micros(cost.input),
                    outputMicros: micros(cost.output),
                  },
                ] as [string, z.infer<typeof modelPriceSchema>],
              ]
            : []
        )
      ),
    ])
  ) as PriceSnapshot["prices"],
  source: MODELS_DEV_URL,
});
