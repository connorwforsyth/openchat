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

/** One model a catalog lists, with whatever it says about it (096 shows some). */
export const catalogModelSchema = z.object({
  contextWindow: z.int().min(1).nullable(),
  description: z.string().nullable(),
  id: z.string().min(1),
  /** The provider's display name, when it gives one. */
  name: z.string().nullable(),
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
    name = null,
  }: Partial<CatalogModel>
): CatalogModel => ({ contextWindow, description, id, name });

// Types a gateway lists that aren't chat models (the Vercel AI Gateway says
// `embedding` / `image`; Together says `embedding`, `image`, `audio`, …).
const CHAT_TYPES = new Set(["chat", "code", "language"]);

const openAiList = z.object({
  data: z.array(
    z.looseObject({
      context_length: positive,
      context_window: positive,
      description: text,
      id: z.string().min(1),
      name: text,
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
            .filter((model) => !model.type || CHAT_TYPES.has(model.type))
            .map((model) =>
              entry(model.id, {
                contextWindow: model.context_window ?? model.context_length,
                description: model.description,
                name: model.name,
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
                model.supportedGenerationMethods.includes("generateContent")
            )
            .map((model) =>
              entry(model.name.replace(GOOGLE_PREFIX, ""), {
                contextWindow: model.inputTokenLimit,
                description: model.description,
                name: model.displayName,
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
