import type { EmbeddingModelV4 } from "@ai-sdk/provider";
import type { AppConfig } from "@workspace/config/schema";
import {
  type ModelRef,
  parseModelRef,
} from "@workspace/contract/schemas/models";
import { err, ok, type Result } from "@workspace/shared/result";
import {
  APICallError,
  embedMany,
  RetryError,
  TooManyEmbeddingValuesForCallError,
} from "ai";

import type { ChatKeys } from "../keys/resolve";
import type { Embedder, EmbedderError } from "../ports/embedder";
import type { ProviderRegistry } from "../ports/provider-registry";

// The Embedder adapter over the AI SDK's `embedMany` (PLAN.md §8 RAG step 4).
// The model is app.config.yaml `embeddings.model`; its dimension comes from
// `embeddings.dimensions`, or from a table of common models when that's
// unset. Every vector is checked against it, since chunks record the
// dimension and a model that quietly changed size would poison the index.

/** Output sizes of common embedding models, so most configs can leave `dimensions` out. */
const KNOWN_DIMENSIONS: Readonly<Record<string, number>> = {
  "all-minilm": 384,
  "bge-large": 1024,
  "bge-m3": 1024,
  "embed-english-v3.0": 1024,
  "embed-multilingual-v3.0": 1024,
  "gemini-embedding-001": 3072,
  "mxbai-embed-large": 1024,
  "nomic-embed-text": 768,
  "snowflake-arctic-embed": 1024,
  "text-embedding-3-large": 3072,
  "text-embedding-3-small": 1536,
  "text-embedding-004": 768,
  "text-embedding-ada-002": 1536,
};

/** The known size for a model id, ignoring an Ollama-style `:tag`. */
export const knownDimensions = (ref: ModelRef): number | undefined => {
  const modelId = parseModelRef(ref)?.modelId;
  return modelId
    ? KNOWN_DIMENSIONS[modelId.split(":")[0] ?? modelId]
    : undefined;
};

const retryAfter = (headers: Record<string, string> | undefined) => {
  const value = Number(headers?.["retry-after"]);
  return Number.isFinite(value) && value >= 0 ? value : null;
};

/** A failed `embedMany` as a port error; never the provider's message, which can echo input. */
export const toEmbedderError = (cause: unknown): EmbedderError => {
  if (RetryError.isInstance(cause)) {
    return toEmbedderError(cause.lastError);
  }
  if (TooManyEmbeddingValuesForCallError.isInstance(cause)) {
    return { message: "Too many inputs for one call.", type: "too_large" };
  }
  if (APICallError.isInstance(cause)) {
    if (cause.statusCode === 429) {
      return {
        retryAfterSeconds: retryAfter(cause.responseHeaders),
        type: "rate_limited",
      };
    }
    if (cause.statusCode === 413) {
      return {
        message: "An input is too long for the model.",
        type: "too_large",
      };
    }
    return {
      message:
        cause.statusCode === undefined
          ? "The embedding provider couldn't be reached."
          : `The embedding provider answered ${cause.statusCode}.`,
      type: "unavailable",
    };
  }
  return { message: "Embedding failed.", type: "unavailable" };
};

export interface AiSdkEmbedderOptions {
  readonly dimensions: number;
  /** Inputs per `embed` call; `embedMany` splits further to the model's own limit. */
  readonly maxBatchSize?: number;
  /** Retries per underlying call, for transient provider errors. */
  readonly maxRetries?: number;
  readonly model: EmbeddingModelV4;
  readonly ref: ModelRef;
}

export const createAiSdkEmbedder = ({
  dimensions,
  maxBatchSize = 256,
  maxRetries = 2,
  model,
  ref,
}: AiSdkEmbedderOptions): Embedder => ({
  dimensions,
  embed: async (values, options = {}) => {
    if (values.length === 0) {
      return ok({ embeddings: [], usage: { tokens: 0 } });
    }
    if (values.length > maxBatchSize) {
      return err({
        message: `${values.length} inputs; the limit is ${maxBatchSize}`,
        type: "too_large" as const,
      });
    }
    try {
      const result = await embedMany({
        abortSignal: options.signal,
        maxRetries,
        model,
        values: [...values],
      });
      const wrongSize = result.embeddings.find(
        (embedding) => embedding.length !== dimensions
      );
      if (wrongSize || result.embeddings.length !== values.length) {
        return err({
          message: wrongSize
            ? `${ref} returned ${wrongSize.length}-dimension vectors; embeddings.dimensions says ${dimensions}`
            : `${ref} returned ${result.embeddings.length} vectors for ${values.length} inputs`,
          type: "unavailable" as const,
        });
      }
      return ok({
        embeddings: result.embeddings,
        usage: { tokens: result.usage.tokens },
      });
    } catch (cause) {
      return err(toEmbedderError(cause));
    }
  },
  maxBatchSize,
  model: ref,
});

export type EmbedderUnavailable =
  | { readonly type: "not_configured" }
  | { readonly message: string; readonly type: "unavailable" };

/**
 * The Embedder app.config.yaml asks for, paid for by `keys`. With no
 * `embeddings.model` (the default) there's none: files still upload and
 * attach, but nothing is indexed and `file_search` isn't offered.
 */
export const createEmbedder = (
  config: Pick<AppConfig, "embeddings">,
  {
    keys,
    registry,
  }: { readonly keys: ChatKeys; readonly registry: ProviderRegistry }
): Result<Embedder, EmbedderUnavailable> => {
  const ref = config.embeddings.model;
  if (!ref) {
    return err({ type: "not_configured" });
  }
  const dimensions = config.embeddings.dimensions ?? knownDimensions(ref);
  if (!dimensions) {
    return err({
      message: `the size of ${ref}'s vectors isn't known; set embeddings.dimensions`,
      type: "unavailable",
    });
  }
  const provider = parseModelRef(ref)?.provider ?? "";
  const model = registry.embeddingModel(ref, keys[provider]);
  if (!model.ok) {
    return err({
      message: `the embedding model ${ref} isn't available (${model.error.type})`,
      type: "unavailable",
    });
  }
  return ok(createAiSdkEmbedder({ dimensions, model: model.value, ref }));
};
