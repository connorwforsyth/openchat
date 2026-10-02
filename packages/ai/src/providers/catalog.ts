import type { ProviderConfig } from "@workspace/config/schema";
import { parseModelRef } from "@workspace/contract/schemas/models";
import {
  type AsyncResult,
  err,
  ok,
  type Result,
} from "@workspace/shared/result";
import { z } from "zod";

import type { ProviderCredentials } from "../ports/provider-registry";
import { type FetchFunction, isKeyless } from "./factory";

// A provider's model catalog (095): what it says it serves, for providers
// with `discover: true`. One GET per provider and key, with the same key a
// model call in that context would use (D17); the key goes in a header,
// never the URL, and neither is ever part of an error or a log line.

/** What a catalog says a model costs, in micro-USD per million tokens (099). */
export const catalogPricingSchema = z.object({
  input: z.int().min(0).optional(),
  output: z.int().min(0).optional(),
});
export type CatalogPricing = z.infer<typeof catalogPricingSchema>;

/**
 * What a catalog says a model can or can't do (099): `true` or `false` only
 * where it says so; a missing key is unknown.
 */
export const catalogTraitsSchema = z.object({
  files: z.boolean().optional(),
  /** It writes images in its own reply (138). */
  imageOutput: z.boolean().optional(),
  reasoning: z.boolean().optional(),
  tools: z.boolean().optional(),
  vision: z.boolean().optional(),
});
export type CatalogTraits = z.infer<typeof catalogTraitsSchema>;

/** One model a catalog lists, with whatever it says about it (096 shows some). */
export const catalogModelSchema = z.object({
  contextWindow: z.int().min(1).nullable(),
  description: z.string().nullable(),
  id: z.string().min(1),
  /**
   * `image` for an image model (138): `generate_image` may draw with it,
   * and the chat picker never lists it. Absent for a chat model.
   */
  kind: z.literal("image").optional(),
  /** The provider's display name, when it gives one. */
  name: z.string().nullable(),
  /** Absent when it lists no price. */
  pricing: catalogPricingSchema.optional(),
  /** Absent when it says nothing about capabilities. */
  traits: catalogTraitsSchema.optional(),
});
export type CatalogModel = z.infer<typeof catalogModelSchema>;

export const catalogErrorSchema = z.discriminatedUnion("type", [
  /** Azure and Bedrock have no catalog we read. */
  z.object({ type: z.literal("unsupported") }),
  z.object({ type: z.literal("missing_key") }),
  z.object({ status: z.int(), type: z.literal("http") }),
  z.object({ type: z.literal("timeout") }),
  z.object({ type: z.literal("unreachable") }),
  z.object({ type: z.literal("invalid_response") }),
]);
export type CatalogError = z.infer<typeof catalogErrorSchema>;

/** Which wire format a provider's catalog speaks. */
export type CatalogKind = "anthropic" | "google" | "ollama" | "openai";

/**
 * `openai-compatible` speaks OpenAI's `/models`, except Ollama, whose tags
 * endpoint lists what's pulled: the provider id `ollama`, or
 * `options.catalog: ollama` for another name.
 */
export const catalogKindOf = (
  id: string,
  config: ProviderConfig
): CatalogKind | null => {
  switch (config.type) {
    case "openai":
      return "openai";
    case "anthropic":
      return "anthropic";
    case "google":
      return "google";
    case "openai-compatible": {
      const declared = config.options.catalog;
      if (declared === "ollama" || declared === "openai") {
        return declared;
      }
      return id === "ollama" ? "ollama" : "openai";
    }
    case "azure":
    case "bedrock":
      return null;
    default:
      return config.type satisfies never;
  }
};

const DEFAULT_BASE_URL: Readonly<Record<string, string>> = {
  anthropic: "https://api.anthropic.com/v1",
  google: "https://generativelanguage.googleapis.com/v1beta",
  openai: "https://api.openai.com/v1",
};

const TRAILING_SLASHES = /\/+$/;
const TRAILING_V1 = /\/v1$/;

const trimSlash = (url: string) => url.replace(TRAILING_SLASHES, "");

// ---- Parsers: tolerant of extra fields, strict about the ones we read. ----

const positive = z.number().int().positive().optional().catch(undefined);
const text = z.string().min(1).optional().catch(undefined);

const entry = (
  id: string,
  {
    contextWindow = null,
    description = null,
    kind,
    name = null,
    pricing,
    traits,
  }: Partial<CatalogModel>
): CatalogModel => ({
  contextWindow,
  description,
  id,
  ...(kind === undefined ? {} : { kind }),
  name,
  ...(pricing === undefined || Object.keys(pricing).length === 0
    ? {}
    : { pricing }),
  ...(traits === undefined || Object.keys(traits).length === 0
    ? {}
    : { traits }),
});

// Gateways price per token in USD, as a string (`"0.000003"`) or a number.
// A negative price is OpenRouter's "varies"; anything unreadable is unknown.
const perToken = z
  .union([z.string(), z.number()])
  .optional()
  .catch(undefined)
  .transform((value) => {
    const usd = typeof value === "string" ? Number(value) : value;
    return usd !== undefined && Number.isFinite(usd) && usd >= 0
      ? Math.round(usd * 1e12)
      : undefined;
  });

const pricingOf = (
  input: number | undefined,
  output: number | undefined
): CatalogPricing => ({
  ...(input === undefined ? {} : { input }),
  ...(output === undefined ? {} : { output }),
});

const strings = z.array(z.string()).optional().catch(undefined);

/**
 * What an OpenAI-style entry says it can do. The Vercel AI Gateway tags what
 * a model does (`tool-use`, `vision`, `reasoning`, `file-input`), so a tag
 * means yes and its absence says nothing. OpenRouter lists every parameter
 * and input a model takes, so there a missing one means no.
 */
const openAiTraits = (model: {
  architecture?:
    | {
        input_modalities?: string[] | undefined;
        output_modalities?: string[] | undefined;
      }
    | undefined;
  supported_parameters?: string[] | undefined;
  tags?: string[] | undefined;
}): CatalogTraits => {
  const traits: CatalogTraits = {};
  const { tags } = model;
  if (tags) {
    if (tags.includes("tool-use")) {
      traits.tools = true;
    }
    if (tags.includes("vision")) {
      traits.vision = true;
    }
    if (tags.includes("reasoning")) {
      traits.reasoning = true;
    }
    if (tags.includes("file-input")) {
      traits.files = true;
    }
    if (tags.includes("image-generation")) {
      traits.imageOutput = true;
    }
  }
  const parameters = model.supported_parameters;
  if (parameters) {
    traits.tools = parameters.includes("tools");
    traits.reasoning = parameters.includes("reasoning");
  }
  const inputs = model.architecture?.input_modalities;
  if (inputs) {
    traits.vision = inputs.includes("image");
    traits.files = inputs.includes("file");
  }
  const outputs = model.architecture?.output_modalities;
  if (outputs) {
    traits.imageOutput = outputs.includes("image");
  }
  return traits;
};

// Types a gateway lists that aren't chat models (the Vercel AI Gateway says
// `embedding` / `image`; Together says `embedding`, `image`, `audio`, …).
// Image models are kept apart for `generate_image` (138); the rest are
// dropped.
const CHAT_TYPES = new Set(["chat", "code", "language"]);
const IMAGE_TYPE = "image";

/**
 * OpenAI's and Google's own catalogs don't type their models, so their
 * image models are known by name: `gpt-image-1`, `dall-e-3`, `imagen-4.0-…`.
 */
const IMAGE_MODEL_ID =
  /^(?:models\/)?(?:gpt-image|chatgpt-image|dall-e|imagen)-/;

const openAiList = z.object({
  data: z.array(
    z.looseObject({
      architecture: z
        .looseObject({
          input_modalities: strings,
          output_modalities: strings,
        })
        .optional()
        .catch(undefined),
      context_length: positive,
      context_window: positive,
      description: text,
      id: z.string().min(1),
      name: text,
      pricing: z
        .looseObject({
          completion: perToken,
          input: perToken,
          output: perToken,
          prompt: perToken,
        })
        .optional()
        .catch(undefined),
      supported_parameters: strings,
      tags: strings,
      type: z.string().optional().catch(undefined),
    })
  ),
});

const anthropicList = z.object({
  data: z.array(
    z.looseObject({
      display_name: text,
      id: z.string().min(1),
      max_input_tokens: positive,
    })
  ),
});

const googleList = z.object({
  models: z.array(
    z.looseObject({
      description: text,
      displayName: text,
      inputTokenLimit: positive,
      name: z.string().min(1),
      supportedGenerationMethods: z.array(z.string()).optional(),
      thinking: z.boolean().optional().catch(undefined),
    })
  ),
});

const ollamaList = z.object({
  models: z.array(z.looseObject({ name: z.string().min(1) })),
});

const GOOGLE_PREFIX = /^models\//;

/** A catalog response body to its models. Pure; `null` for an unexpected shape. */
export const parseCatalog = (
  kind: CatalogKind,
  body: unknown
): readonly CatalogModel[] | null => {
  switch (kind) {
    case "openai": {
      const parsed = openAiList.safeParse(body);
      return parsed.success
        ? parsed.data.data
            .filter(
              (model) =>
                !model.type ||
                CHAT_TYPES.has(model.type) ||
                model.type === IMAGE_TYPE
            )
            .map((model) =>
              entry(model.id, {
                contextWindow: model.context_window ?? model.context_length,
                description: model.description,
                kind:
                  model.type === IMAGE_TYPE ||
                  (!model.type && IMAGE_MODEL_ID.test(model.id))
                    ? "image"
                    : undefined,
                name: model.name,
                pricing: pricingOf(
                  model.pricing?.input ?? model.pricing?.prompt,
                  model.pricing?.output ?? model.pricing?.completion
                ),
                traits: openAiTraits(model),
              })
            )
        : null;
    }
    case "anthropic": {
      const parsed = anthropicList.safeParse(body);
      return parsed.success
        ? parsed.data.data.map((model) =>
            entry(model.id, {
              contextWindow: model.max_input_tokens,
              name: model.display_name,
            })
          )
        : null;
    }
    case "google": {
      const parsed = googleList.safeParse(body);
      return parsed.success
        ? parsed.data.models
            .filter(
              (model) =>
                !model.supportedGenerationMethods ||
                model.supportedGenerationMethods.includes("generateContent") ||
                IMAGE_MODEL_ID.test(model.name)
            )
            .map((model) =>
              entry(model.name.replace(GOOGLE_PREFIX, ""), {
                contextWindow: model.inputTokenLimit,
                description: model.description,
                kind: IMAGE_MODEL_ID.test(model.name) ? "image" : undefined,
                name: model.displayName,
                traits:
                  model.thinking === undefined
                    ? undefined
                    : { reasoning: model.thinking },
              })
            )
        : null;
    }
    case "ollama": {
      const parsed = ollamaList.safeParse(body);
      return parsed.success
        ? parsed.data.models.map((model) => entry(model.name, {}))
        : null;
    }
    default:
      return kind satisfies never;
  }
};

/** The request that lists `id`'s models with `credentials`. Pure. */
export const catalogRequest = (
  id: string,
  config: ProviderConfig,
  credentials: ProviderCredentials | undefined
): Result<
  {
    readonly headers: Readonly<Record<string, string>>;
    readonly kind: CatalogKind;
    readonly url: string;
  },
  CatalogError
> => {
  const kind = catalogKindOf(id, config);
  if (!kind) {
    return err({ type: "unsupported" });
  }
  // Same rule as a model call: another provider's key is no key at all.
  const key = credentials?.provider === id ? credentials : undefined;
  if (!(key || isKeyless(config))) {
    return err({ type: "missing_key" });
  }
  const base = key?.baseURL ?? config.baseURL ?? DEFAULT_BASE_URL[kind];
  if (!base) {
    return err({ type: "unsupported" });
  }
  const root = trimSlash(base);
  const apiKey = key?.apiKey;
  switch (kind) {
    case "openai":
      return ok({
        headers: {
          ...config.headers,
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        },
        kind,
        url: `${root}/models`,
      });
    case "anthropic":
      return ok({
        headers: {
          "anthropic-version": "2023-06-01",
          ...config.headers,
          ...(apiKey ? { "x-api-key": apiKey } : {}),
        },
        kind,
        url: `${root}/models?limit=1000`,
      });
    case "google":
      // The key goes in a header: a `?key=` URL ends up in proxy logs.
      return ok({
        headers: {
          ...config.headers,
          ...(apiKey ? { "x-goog-api-key": apiKey } : {}),
        },
        kind,
        url: `${root}/models?pageSize=1000`,
      });
    case "ollama":
      return ok({
        headers: {
          ...config.headers,
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        },
        kind,
        url: `${root.replace(TRAILING_V1, "")}/api/tags`,
      });
    default:
      return kind satisfies never;
  }
};

/** Entries whose id can't form a `provider:model` ref are dropped. */
const validFor = (id: string, models: readonly CatalogModel[]) => {
  const seen = new Set<string>();
  return models.filter((model) => {
    if (seen.has(model.id) || !parseModelRef(`${id}:${model.id}`)) {
      return false;
    }
    seen.add(model.id);
    return true;
  });
};

export interface FetchCatalogOptions {
  readonly fetch?: FetchFunction;
  readonly signal?: AbortSignal;
  /** Default 5 s: the picker waits on this. */
  readonly timeoutMs?: number;
}

export const DEFAULT_CATALOG_TIMEOUT_MS = 5000;

/** Whether a catalog entry is an image model rather than a chat model (138). */
export const isImageModel = (model: Pick<CatalogModel, "kind">): boolean =>
  model.kind === "image";

/** Lists `id`'s models. Never throws; errors carry no URL, header or body. */
export const fetchCatalog = async (
  id: string,
  config: ProviderConfig,
  credentials: ProviderCredentials | undefined,
  {
    fetch = globalThis.fetch,
    signal,
    timeoutMs = DEFAULT_CATALOG_TIMEOUT_MS,
  }: FetchCatalogOptions = {}
): AsyncResult<readonly CatalogModel[], CatalogError> => {
  const request = catalogRequest(id, config, credentials);
  if (!request.ok) {
    return request;
  }
  const { headers, kind, url } = request.value;
  const timeout = AbortSignal.timeout(timeoutMs);
  let response: Response;
  try {
    response = await fetch(url, {
      headers,
      method: "GET",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch {
    return err({ type: timeout.aborted ? "timeout" : "unreachable" });
  }
  if (!response.ok) {
    return err({ status: response.status, type: "http" });
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return err({
      type: timeout.aborted ? "timeout" : "invalid_response",
    });
  }
  const models = parseCatalog(kind, body);
  return models ? ok(validFor(id, models)) : err({ type: "invalid_response" });
};

/** A short, secret-free reason for a log line. */
export const describeCatalogError = (error: CatalogError): string => {
  switch (error.type) {
    case "http":
      return `HTTP ${error.status}`;
    case "invalid_response":
      return "an unexpected response";
    case "missing_key":
      return "no key";
    case "timeout":
      return "a timeout";
    case "unreachable":
      return "no connection";
    case "unsupported":
      return "no catalog for this provider type";
    default:
      return error satisfies never;
  }
};
