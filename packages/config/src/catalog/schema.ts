import { z } from "zod";

import { modelPriceSchema } from "../schema";

// The model catalogue's shapes, apart from its data so the refresh script
// can load them before there's a catalogue to parse.

export const CATALOG_SOURCES = {
  prices: "https://models.dev/api.json",
  speed: "https://ai-gateway.vercel.sh/v1/models",
} as const;

/** The models.dev providers whose list prices we keep. */
export const priceSourceSchema = z.enum([
  "anthropic",
  "google",
  "openai",
  "vercel",
]);
export type PriceSource = z.infer<typeof priceSourceSchema>;

const ratingSchema = z.int().min(1).max(5);

export const generatedCatalogSchema = z.strictObject({
  fetchedAt: z.iso.datetime(),
  /** Prices by source, then by the model id that source's API takes. */
  prices: z.record(
    priceSourceSchema,
    z.record(z.string().min(1), modelPriceSchema)
  ),
  sources: z.strictObject({
    prices: z.literal(CATALOG_SOURCES.prices),
    speed: z.literal(CATALOG_SOURCES.speed),
  }),
  /** Median output tokens per second over the last hour, by Gateway id. */
  tokensPerSecond: z.record(z.string().min(1), z.int().min(1)),
});
export type GeneratedCatalog = z.infer<typeof generatedCatalogSchema>;

export const intelligenceSchema = z.record(z.string().min(1), ratingSchema);
