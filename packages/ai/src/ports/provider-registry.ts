import type { EmbeddingModelV4, LanguageModelV4 } from "@ai-sdk/provider";
import { keyScopeSchema } from "@workspace/contract/schemas/keys";
import {
  type ModelOption,
  type ModelRef,
  type ModelSelector,
  providerIdSchema,
} from "@workspace/contract/schemas/models";
import type { Result } from "@workspace/shared/result";
import { z } from "zod";

// The ProviderRegistry port (D3). Built from app.config.yaml `providers` and
// `models`; hands out AI SDK model instances for a ref, using whichever key
// `resolveChatKeys` picked for the chat context. Building a model object is
// synchronous: it makes no network call, and failures are config problems.
// Listing and `checkModel` are async, because a provider with
// `discover: true` answers from its catalog (095).

/** A key chosen for one call. Held in memory only; never logged or returned by the API. */
export const providerCredentialsSchema = z.object({
  apiKey: z.string().min(1),
  baseURL: z.url().optional(),
  provider: providerIdSchema,
  /** Whose key this is, for usage attribution (D17). */
  source: keyScopeSchema,
});
export type ProviderCredentials = z.infer<typeof providerCredentialsSchema>;

export const providerRegistryErrorSchema = z.discriminatedUnion("type", [
  /** Neither an alias nor a `provider:model` ref the config knows. */
  z.object({ selector: z.string(), type: z.literal("unknown_model") }),
  z.object({ provider: z.string(), type: z.literal("unknown_provider") }),
  /** The provider needs a key and none was passed (and it has no keyless mode). */
  z.object({ provider: z.string(), type: z.literal("missing_key") }),
  /**
   * A well-formed ref this instance doesn't offer: outside the provider's
   * `include` / `exclude`, or missing from its discovered catalog.
   */
  z.object({ selector: z.string(), type: z.literal("not_offered") }),
  /** For example, an embedding model from a provider that has none. */
  z.object({ message: z.string(), type: z.literal("unsupported") }),
]);
export type ProviderRegistryError = z.infer<typeof providerRegistryErrorSchema>;

/** The key per provider for one chat context (`ChatKeys` from `resolveChatKeys`). */
export type ProviderKeys = Readonly<Record<string, ProviderCredentials>>;

export interface ProviderRegistry {
  /**
   * Whether a resolved ref may run with these credentials. Refs the config
   * names (`models`, alias targets, `models.default`, the `auto` ends) always
   * may; anything else must pass the provider's `include` / `exclude` and,
   * with `discover: true`, be in its catalog. `resolve` only checks shape.
   */
  checkModel: (
    ref: ModelRef,
    credentials?: ProviderCredentials,
    options?: { readonly signal?: AbortSignal }
  ) => Promise<Result<ModelRef, ProviderRegistryError>>;
  /** An embedding model for RAG indexing and search. */
  embeddingModel: (
    ref: ModelRef,
    credentials?: ProviderCredentials
  ) => Result<EmbeddingModelV4, ProviderRegistryError>;
  /** A language model for `streamText` / `ToolLoopAgent`. Pass a resolved ref, not an alias. */
  languageModel: (
    ref: ModelRef,
    credentials?: ProviderCredentials
  ) => Result<LanguageModelV4, ProviderRegistryError>;
  /**
   * The picker's options. `available` is true when the provider needs no key
   * (a local Ollama) or `keys` has one for it. A discovering provider's
   * catalog is fetched with that same key, so a context only ever sees the
   * models its own keys can list.
   */
  listModels: (
    keys: ProviderKeys,
    options?: { readonly signal?: AbortSignal }
  ) => Promise<readonly ModelOption[]>;
  /**
   * An alias to its ref; a ref to itself after checking its provider exists.
   * `auto` isn't resolvable here: the Decider routes it first.
   */
  resolve: (selector: ModelSelector) => Result<ModelRef, ProviderRegistryError>;
}
