import {
  type ModelRef,
  parseModelRef,
} from "@workspace/contract/schemas/models";

import type { AppConfig, ModelPrice, ProviderConfig } from "../schema";
import { GENERATED_CATALOG } from "./generated";
import { INTELLIGENCE } from "./intelligence";
import {
  generatedCatalogSchema,
  intelligenceSchema,
  type PriceSource,
} from "./schema";

// The model catalogue: what the repo knows about models, apart from
// app.config. `generated.ts` (prices from models.dev, speed from the Vercel AI
// Gateway) is written only by `bun run catalog:refresh`; `intelligence.ts` is
// curated by hand. Nothing here is fetched at runtime. For every field
// app.config's override wins, then the catalogue, then nothing.

const generated = generatedCatalogSchema.parse(GENERATED_CATALOG);
const intelligence = intelligenceSchema.parse(INTELLIGENCE);

const GATEWAY_HOSTS: Readonly<Record<string, PriceSource>> = {
  "ai-gateway.vercel.sh": "vercel",
};

const gatewayOf = (provider: ProviderConfig): PriceSource | undefined =>
  provider.baseURL === undefined
    ? undefined
    : GATEWAY_HOSTS[new URL(provider.baseURL).hostname];

/** Where a configured provider's list prices live in the catalogue, if anywhere. */
export const priceSourceOf = (
  provider: ProviderConfig
): PriceSource | undefined => {
  switch (provider.type) {
    case "anthropic":
    case "google":
    case "openai":
      return provider.type;
    case "openai-compatible":
      return gatewayOf(provider);
    // Azure and Bedrock name deployments, not models.
    case "azure":
    case "bedrock":
      return;
    default:
      return provider.type satisfies never;
  }
};

/** Every list price for a provider's models, by that provider's model id. */
export const listPricesOf = (
  provider: ProviderConfig
): Readonly<Record<string, ModelPrice>> => {
  const source = priceSourceOf(provider);
  return source === undefined ? {} : generated.prices[source];
};

/**
 * The catalogue's id for a model (`creator/model`, as the Gateway names it):
 * a Gateway model's own id, a native provider's model under its maker, and
 * any other provider's (a local Ollama) under the provider's id.
 */
export const catalogIdOf = (
  providerId: string,
  provider: ProviderConfig,
  modelId: string
): string | undefined => {
  switch (provider.type) {
    case "anthropic":
    case "google":
    case "openai":
      return `${provider.type}/${modelId}`;
    case "openai-compatible":
      return gatewayOf(provider) ? modelId : `${providerId}/${modelId}`;
    case "azure":
    case "bedrock":
      return;
    default:
      return provider.type satisfies never;
  }
};

const DATE_SUFFIX = /-\d{8}$/;

/**
 * One spelling for a model's versions: Anthropic's API writes
 * `claude-haiku-5-5` (sometimes dated) where the Gateway writes
 * `claude-haiku-5.5`.
 */
export const normalizeModelId = (id: string): string =>
  id.toLowerCase().replaceAll(".", "-").replace(DATE_SUFFIX, "");

const lookup = <T>(table: Readonly<Record<string, T>>) => {
  const normalized = new Map(
    Object.entries(table).map(([id, value]) => [normalizeModelId(id), value])
  );
  return (id: string): T | undefined =>
    Object.hasOwn(table, id) ? table[id] : normalized.get(normalizeModelId(id));
};

const speedOf = lookup(generated.tokensPerSecond);
const intelligenceOf = lookup(intelligence);

/**
 * Output tokens per second at which a model's speed rating steps up:
 * under 50 is 1, 50 to 99 is 2, 100 to 149 is 3, 150 to 299 is 4, and 300
 * or more is 5. Fixed so a rating means the same from one refresh to the next.
 */
export const SPEED_STEPS = [50, 100, 150, 300] as const;

export const speedRating = (tokensPerSecond: number): number =>
  1 + SPEED_STEPS.filter((step) => tokensPerSecond >= step).length;

type Ratings = AppConfig["models"]["ratings"][string];

/** What the catalogue rates a model, if anything. */
export const catalogRatingsOf = (
  catalogId: string | undefined
): Partial<Ratings> => {
  if (catalogId === undefined) {
    return {};
  }
  const tokensPerSecond = speedOf(catalogId);
  const smart = intelligenceOf(catalogId);
  return {
    ...(smart === undefined ? {} : { intelligence: smart }),
    ...(tokensPerSecond === undefined
      ? {}
      : { speed: speedRating(tokensPerSecond) }),
  };
};

/**
 * A model's ratings for the picker: the alias's in `models.ratings`, else
 * its ref's, with the catalogue's filling any field they leave out.
 */
export const ratingsOf = (
  config: Pick<AppConfig, "models"> & Partial<Pick<AppConfig, "providers">>,
  selector: string,
  target: ModelRef | undefined
): Ratings | undefined => {
  const { ratings } = config.models;
  const ref = target === undefined ? undefined : parseModelRef(target);
  const provider =
    ref === undefined ? undefined : config.providers?.[ref.provider];
  const listed =
    ref && provider
      ? catalogRatingsOf(catalogIdOf(ref.provider, provider, ref.modelId))
      : {};
  const own = {
    ...listed,
    ...(ratings[selector] ??
      (target === undefined ? undefined : ratings[target])),
  };
  return own.intelligence === undefined && own.speed === undefined
    ? undefined
    : own;
};
