import { createHash } from "node:crypto";

import type { ImageModelV4, ProviderV4 } from "@ai-sdk/provider";
import { ratingsOf } from "@workspace/config/catalog";
import { effectivePrices } from "@workspace/config/prices";
import type { AppConfig } from "@workspace/config/schema";
import {
  AUTO_MODEL,
  type ModelOption,
  type ModelRef,
  parseModelRef,
} from "@workspace/contract/schemas/models";
import {
  type AsyncResult,
  err,
  ok,
  type Result,
  tryCatch,
} from "@workspace/shared/result";

import type {
  ProviderCredentials,
  ProviderKeys,
  ProviderRegistry,
  ProviderRegistryError,
} from "../ports/provider-registry";
import { type ModelCapability, providerCapabilities } from "./capabilities";
import {
  type CatalogError,
  type CatalogModel,
  catalogFromServer,
  describeCatalogError,
  fetchCatalog,
  isImageModel,
} from "./catalog";
import {
  capabilitiesWith,
  costOf,
  displayNameOf,
  oneLine,
  vendorOf,
} from "./describe";
import {
  createProvider,
  isKeyless,
  type ProviderFactoryOptions,
} from "./factory";
import { patternFilter } from "./patterns";

// The config-driven ProviderRegistry (D3): app.config.yaml `providers` and
// `models.aliases` in, AI SDK models out. It implements the port rather than
// returning the SDK's `createProviderRegistry`, because the port takes the
// key per call (keys depend on the chat context, D17) and resolves aliases to
// refs the run records as `resolvedModel`.

export type RegistryConfig = Pick<AppConfig, "models" | "providers">;

type ModelKind = "embeddingModel" | "imageModel" | "languageModel";

export interface RegistryOptions extends ProviderFactoryOptions {
  /** Catalog fetches' timeout; default 5 s. */
  readonly catalogTimeoutMs?: number;
  /** Failures worth a log line (a catalog that didn't answer); never given secrets. */
  readonly log?: (message: string) => void;
  /** For the catalog cache; `Date.now` by default. */
  readonly now?: () => number;
}

/** An image model `generate_image` may draw with (138), as one context sees it. */
export interface ImageModelChoice {
  /** Whether this context has a key for it, or it needs none. */
  readonly available: boolean;
  readonly displayName: string;
  readonly target: ModelRef;
}

/** The port, plus what discovery found out about each model, kept for 096. */
export interface DiscoveringRegistry extends ProviderRegistry {
  /**
   * `provider`'s catalog with these credentials (cached), or `null` when it
   * doesn't discover (Ollama's is always read) or its catalog couldn't be read.
   */
  catalog: (
    provider: string,
    credentials: ProviderCredentials | undefined
  ) => Promise<readonly CatalogModel[] | null>;
  /** An image model for `generate_image` (138). Pass a ref, not an alias. */
  imageModel: (
    ref: ModelRef,
    credentials: ProviderCredentials | undefined
  ) => Result<ImageModelV4, ProviderRegistryError>;
  /**
   * The image models on offer, in order: `models.image.default`, then
   * `models.image.models`, then (with `models.image.discover`) the image
   * models discovering providers' catalogs list for these keys. Never the
   * chat picker's.
   */
  imageModels: (keys: ProviderKeys) => Promise<readonly ImageModelChoice[]>;
}

// A catalog that failed is retried after this long (or the TTL, if shorter),
// so a provider that was briefly down doesn't hide its models for an hour.
const FAILURE_TTL_MS = 60_000;
// Entries past this many trigger a sweep of expired ones.
const CACHE_SWEEP_AT = 256;

interface CacheEntry {
  expiresAt: number;
  readonly result: AsyncResult<readonly CatalogModel[], CatalogError>;
}

/** Caches per provider and key without holding the key: a hash stands in. */
const cacheKey = (
  provider: string,
  credentials: ProviderCredentials | undefined
): string => {
  const key = credentials?.provider === provider ? credentials : undefined;
  const digest = key
    ? createHash("sha256")
        .update(`${key.baseURL ?? ""}\0${key.apiKey}`)
        .digest("base64url")
    : "keyless";
  return `${provider}\0${digest}`;
};

export const buildRegistry = (
  config: RegistryConfig,
  options: RegistryOptions = {}
): DiscoveringRegistry => {
  const { aliases, descriptions } = config.models;
  const prices = effectivePrices(config);
  const now = options.now ?? Date.now;
  const log = options.log ?? (() => undefined);

  const model = <K extends ModelKind>(
    kind: K,
    ref: ModelRef,
    credentials: ProviderCredentials | undefined
  ): Result<ReturnType<ProviderV4[K]>, ProviderRegistryError> => {
    const parsed = parseModelRef(ref);
    if (!parsed) {
      return err({ selector: ref, type: "unknown_model" });
    }
    const providerConfig = config.providers[parsed.provider];
    if (!providerConfig) {
      return err({ provider: parsed.provider, type: "unknown_provider" });
    }
    const provider = createProvider(
      parsed.provider,
      providerConfig,
      credentials,
      options
    );
    if (!provider.ok) {
      return provider;
    }
    // Providers throw `NoSuchModelError` for a kind they don't offer
    // (Anthropic has no embeddings); that's a config problem, not a crash.
    return tryCatch(
      () => provider.value[kind](parsed.modelId) as ReturnType<ProviderV4[K]>,
      (cause) => ({
        message:
          cause instanceof Error
            ? cause.message
            : `${parsed.provider} has no ${kind} ${parsed.modelId}`,
        type: "unsupported" as const,
      })
    );
  };

  const isAvailable = (
    ref: ModelRef | null,
    keyedProviders: ReadonlySet<string>
  ): boolean => {
    const provider = ref ? parseModelRef(ref)?.provider : undefined;
    const providerConfig = provider ? config.providers[provider] : undefined;
    return Boolean(
      provider &&
        providerConfig &&
        (keyedProviders.has(provider) || isKeyless(providerConfig))
    );
  };

  const resolve: ProviderRegistry["resolve"] = (selector) => {
    if (selector === AUTO_MODEL) {
      return err({ selector, type: "unknown_model" });
    }
    const target = aliases[selector] ?? selector;
    const provider = parseModelRef(target)?.provider;
    if (!provider) {
      return err({ selector, type: "unknown_model" });
    }
    return config.providers[provider]
      ? ok(target)
      : err({ provider, type: "unknown_provider" });
  };

  /** What a ref's provider reads (images, PDFs); none for an unknown one. */
  const capabilitiesOf = (ref: ModelRef | null): ModelCapability[] => {
    const provider = ref ? parseModelRef(ref)?.provider : undefined;
    const providerConfig = provider ? config.providers[provider] : undefined;
    return providerConfig ? [...providerCapabilities(providerConfig)] : [];
  };

  const fromServer = (ref: ModelRef): boolean => {
    const provider = parseModelRef(ref)?.provider;
    const providerConfig = provider ? config.providers[provider] : undefined;
    return Boolean(
      provider && providerConfig && catalogFromServer(provider, providerConfig)
    );
  };

  // `auto` ends may be aliases; the picker shows the ref each resolves to.
  const refOf = (selector: string | null): ModelRef | null => {
    if (!selector) {
      return null;
    }
    const resolved = resolve(selector);
    return resolved.ok ? resolved.value : null;
  };

  // Refs the config names itself: always offered and always runnable,
  // whatever the patterns or a catalog say.
  const pinned = new Set<string>([
    ...Object.values(aliases),
    ...Object.entries(config.providers).flatMap(([provider, providerConfig]) =>
      providerConfig.models.map((modelId) => `${provider}:${modelId}`)
    ),
    ...[
      config.models.default,
      config.models.auto.cheap,
      config.models.auto.strong,
    ]
      .map((selector) => refOf(selector))
      .filter((ref): ref is ModelRef => ref !== null),
  ]);

  const allowedBy = new Map(
    Object.entries(config.providers).map(([provider, providerConfig]) => [
      provider,
      patternFilter(providerConfig),
    ])
  );

  const cache = new Map<string, CacheEntry>();
  /** Providers whose failure is already logged; cleared when they answer again. */
  const failing = new Set<string>();

  const sweep = (at: number) => {
    if (cache.size < CACHE_SWEEP_AT) {
      return;
    }
    for (const [key, entry] of cache) {
      if (entry.expiresAt <= at) {
        cache.delete(key);
      }
    }
  };

  const catalogResult = async (
    provider: string,
    credentials: ProviderCredentials | undefined
  ): AsyncResult<readonly CatalogModel[], CatalogError> => {
    const providerConfig = config.providers[provider];
    // Ollama's metadata is read for what its models can do (vision) even when
    // they aren't discovered: the server's own word, from a local call.
    const reads =
      providerConfig &&
      (providerConfig.discover || catalogFromServer(provider, providerConfig));
    if (!reads) {
      return err({ type: "unsupported" });
    }
    const key = cacheKey(provider, credentials);
    const started = now();
    const hit = cache.get(key);
    if (hit && hit.expiresAt > started) {
      return hit.result;
    }
    sweep(started);
    const ttlMs = providerConfig.discoverTtlSeconds * 1000;
    // Not the caller's signal: other callers may share this fetch.
    const result = fetchCatalog(provider, providerConfig, credentials, {
      fetch: options.fetch,
      timeoutMs: options.catalogTimeoutMs,
    });
    const entry: CacheEntry = { expiresAt: started + ttlMs, result };
    cache.set(key, entry);
    const settled = await result;
    if (settled.ok) {
      failing.delete(provider);
      return settled;
    }
    if (settled.error.type === "missing_key") {
      cache.delete(key);
      return settled;
    }
    entry.expiresAt = Math.min(entry.expiresAt, now() + FAILURE_TTL_MS);
    if (!failing.has(provider)) {
      failing.add(provider);
      log(
        `model discovery for provider "${provider}" failed (${describeCatalogError(settled.error)}); offering its configured models until it answers`
      );
    }
    return settled;
  };

  const catalog: DiscoveringRegistry["catalog"] = async (
    provider,
    credentials
  ) => {
    const result = await catalogResult(provider, credentials);
    return result.ok ? result.value : null;
  };

  /** Every discovering provider's catalog, keyed by ref; keyless or keyed only. */
  const discovered = async (
    keys: ProviderKeys
  ): Promise<ReadonlyMap<ModelRef, CatalogModel>> => {
    const lists = await Promise.all(
      Object.entries(config.providers)
        .filter(([, providerConfig]) => providerConfig.discover)
        .map(async ([provider]) =>
          ((await catalog(provider, keys[provider])) ?? [])
            // Image models are `imageModels`' (138), never the picker's.
            .filter((listed) => !isImageModel(listed))
            .map((listed) => [`${provider}:${listed.id}`, listed] as const)
        )
    );
    return new Map(lists.flat());
  };

  /** Every discovering provider's image models (138), keyed by ref. */
  const discoveredImages = async (
    keys: ProviderKeys
  ): Promise<ReadonlyMap<ModelRef, CatalogModel>> => {
    const lists = await Promise.all(
      Object.entries(config.providers)
        .filter(([, providerConfig]) => providerConfig.discover)
        .map(async ([provider]) =>
          ((await catalog(provider, keys[provider])) ?? [])
            .filter((listed) => isImageModel(listed))
            .map((listed) => [`${provider}:${listed.id}`, listed] as const)
        )
    );
    return new Map(lists.flat());
  };

  const imageModels: DiscoveringRegistry["imageModels"] = async (keys) => {
    const { image } = config.models;
    const keyedProviders = new Set(Object.keys(keys));
    const listed = await discoveredImages(keys);
    const configured = [
      ...(image.default ? [image.default] : []),
      ...image.models,
    ];
    const found = image.discover
      ? [...listed.keys()]
          .filter((ref) => {
            const parsed = parseModelRef(ref);
            return Boolean(
              parsed && allowedBy.get(parsed.provider)?.(parsed.modelId)
            );
          })
          .sort((a, b) => a.localeCompare(b))
      : [];
    const refs = [...new Set([...configured, ...found])];
    return refs.map((ref) => {
      const modelId = parseModelRef(ref)?.modelId ?? ref;
      return {
        available: isAvailable(ref, keyedProviders),
        displayName: displayNameOf(modelId, listed.get(ref)?.name),
        target: ref,
      };
    });
  };

  const configuredOptions = (
    keyedProviders: ReadonlySet<string>
  ): ModelOption[] => {
    const { auto } = config.models;
    const autoOption: ModelOption[] = auto.enabled
      ? [
          {
            available:
              isAvailable(refOf(auto.cheap), keyedProviders) &&
              isAvailable(refOf(auto.strong), keyedProviders),
            capabilities: [],
            contextWindow: null,
            label: AUTO_MODEL,
            selector: AUTO_MODEL,
            target: null,
          },
        ]
      : [];
    const aliased = Object.entries(aliases).map(
      ([alias, ref]): ModelOption => ({
        available: isAvailable(ref, keyedProviders),
        capabilities: capabilitiesOf(ref),
        contextWindow: null,
        label: alias,
        selector: alias,
        target: ref,
      })
    );
    // Refs an alias already offers aren't listed twice.
    const aliasedRefs = new Set(Object.values(aliases));
    const direct = Object.entries(config.providers).flatMap(
      ([provider, providerConfig]) =>
        providerConfig.models
          .map((modelId) => `${provider}:${modelId}`)
          .filter((ref) => parseModelRef(ref) && !aliasedRefs.has(ref))
          .map(
            (ref): ModelOption => ({
              available: isAvailable(ref, keyedProviders),
              capabilities: capabilitiesOf(ref),
              contextWindow: null,
              label: parseModelRef(ref)?.modelId ?? ref,
              selector: ref,
              target: ref,
            })
          )
    );
    return [...autoOption, ...aliased, ...direct];
  };

  /**
   * What the picker says about an option beyond its name. The config's
   * description and ratings, by selector then by the ref it resolves to,
   * beat the catalog's (096, 099). The name and capabilities come
   * from the catalog, else the id and the provider; the price from the
   * catalog, else `effectivePrices`; ratings fall back to the repo's model
   * catalogue (`ratingsOf`).
   */
  const described = (
    option: ModelOption,
    catalogs: ReadonlyMap<ModelRef, CatalogModel>
  ): ModelOption => {
    const { target } = option;
    if (!target) {
      return option;
    }
    const listed = catalogs.get(target);
    const description =
      oneLine(descriptions[option.selector]) ??
      oneLine(descriptions[target]) ??
      oneLine(listed?.description);
    const provider = vendorOf(target);
    const modelId = parseModelRef(target)?.modelId;
    const rated = ratingsOf(config, option.selector, target);
    // The catalog's price, else the one the config bills usage at.
    const priced = prices[target];
    const cost = costOf(
      listed?.pricing ??
        (priced && { input: priced.inputMicros, output: priced.outputMicros })
    );
    return {
      ...option,
      capabilities: capabilitiesWith(option.capabilities, listed?.traits, {
        fromServer: fromServer(target),
      }),
      ...(cost === undefined ? {} : { cost }),
      ...(description === undefined ? {} : { description }),
      ...(modelId === undefined
        ? {}
        : { displayName: displayNameOf(modelId, listed?.name) }),
      ...(provider === undefined ? {} : { provider }),
      ...(rated === undefined ? {} : { ratings: { ...rated } }),
    };
  };

  /** The chat picker's options for these keys: configured, then discovered. */
  const chatOptions = async (keys: ProviderKeys): Promise<ModelOption[]> => {
    const keyedProviders = new Set(Object.keys(keys));
    const configured = configuredOptions(keyedProviders);
    const catalogs = await discovered(keys);
    if (catalogs.size === 0) {
      return configured.map((option) => described(option, catalogs));
    }
    // What a catalog says about a configured model fills its context window.
    const withWindows = configured.map((option) => {
      const known = option.target ? catalogs.get(option.target) : undefined;
      return known?.contextWindow && option.contextWindow === null
        ? { ...option, contextWindow: known.contextWindow }
        : option;
    });
    const listed = new Set(configured.map((option) => option.target));
    const extra = [...catalogs.entries()]
      .filter(([ref, entry]) => {
        const provider = parseModelRef(ref)?.provider ?? "";
        return (
          !listed.has(ref) &&
          (pinned.has(ref) || allowedBy.get(provider)?.(entry.id))
        );
      })
      .sort(([a], [b]) => a.localeCompare(b))
      .map(
        ([ref, entry]): ModelOption => ({
          // Listed only when its catalog answered, so a key (or none
          // needed) is there.
          available: true,
          capabilities: capabilitiesOf(ref),
          contextWindow: entry.contextWindow,
          label: entry.id,
          selector: ref,
          target: ref,
        })
      );
    return [...withWindows, ...extra].map((option) =>
      described(option, catalogs)
    );
  };

  return {
    catalog,

    checkModel: async (ref, credentials) => {
      const parsed = parseModelRef(ref);
      if (!parsed) {
        return err({ selector: ref, type: "unknown_model" });
      }
      const providerConfig = config.providers[parsed.provider];
      if (!providerConfig) {
        return err({ provider: parsed.provider, type: "unknown_provider" });
      }
      if (pinned.has(ref)) {
        return ok(ref);
      }
      if (!allowedBy.get(parsed.provider)?.(parsed.modelId)) {
        return err({ selector: ref, type: "not_offered" });
      }
      if (!providerConfig.discover) {
        return ok(ref);
      }
      const listed = await catalogResult(parsed.provider, credentials);
      if (listed.ok) {
        return listed.value.some(
          (entry) => entry.id === parsed.modelId && !isImageModel(entry)
        )
          ? ok(ref)
          : err({ selector: ref, type: "not_offered" });
      }
      // No key: the same answer a model call gives. A catalog that didn't
      // answer falls back to the configured models, for runs as for the list.
      return listed.error.type === "missing_key"
        ? err({ provider: parsed.provider, type: "missing_key" })
        : err({ selector: ref, type: "not_offered" });
    },

    embeddingModel: (ref, credentials) =>
      model("embeddingModel", ref, credentials),

    imageModel: (ref, credentials) => model("imageModel", ref, credentials),

    imageModels,

    languageModel: (ref, credentials) =>
      model("languageModel", ref, credentials),

    listModels: async (keys) => {
      const [chat, images] = await Promise.all([
        chatOptions(keys),
        imageModels(keys),
      ]);
      return withImageModel(chat, images);
    },

    resolve,
  };
};

/**
 * Each option that can call tools, with the image model `generate_image`
 * would draw with for it (138): the first one this context can use. Pure.
 */
export const withImageModel = (
  options: readonly ModelOption[],
  images: readonly ImageModelChoice[]
): ModelOption[] => {
  const image = images.find((choice) => choice.available);
  return options.map((option) =>
    image && option.target && option.capabilities.includes("tools")
      ? {
          ...option,
          imageModel: { displayName: image.displayName, target: image.target },
        }
      : option
  );
};
