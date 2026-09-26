import type { EmbeddingModelV4, LanguageModelV4 } from "@ai-sdk/provider";
import {
  AUTO_MODEL,
  type ModelOption,
  type ModelRef,
  parseModelRef,
} from "@workspace/contract/schemas/models";
import { err, ok } from "@workspace/shared/result";

import type { ProviderRegistry } from "./provider-registry";

// In-memory ProviderRegistry for tests: models are handed in (usually
// `MockLanguageModelV4` from `ai/test`), keyed by ref. Providers listed in
// `keyless` work without credentials, like a local Ollama.

export interface MemoryProviderRegistryOptions {
  readonly aliases?: Readonly<Record<string, ModelRef>>;
  readonly embeddingModels?: Readonly<Record<ModelRef, EmbeddingModelV4>>;
  readonly keyless?: readonly string[];
  readonly languageModels: Readonly<Record<ModelRef, LanguageModelV4>>;
}

export const createMemoryProviderRegistry = ({
  aliases = {},
  embeddingModels = {},
  keyless = [],
  languageModels,
}: MemoryProviderRegistryOptions): ProviderRegistry => {
  const providers = new Set(
    [...Object.keys(languageModels), ...Object.keys(embeddingModels)].map(
      (ref) => parseModelRef(ref)?.provider ?? ref
    )
  );
  const keylessSet = new Set(keyless);

  const check = (
    ref: ModelRef,
    provider: string | undefined,
    hasKey: boolean
  ) => {
    if (!(provider && providers.has(provider))) {
      return err({
        provider: provider ?? ref,
        type: "unknown_provider" as const,
      });
    }
    if (!(hasKey || keylessSet.has(provider))) {
      return err({ provider, type: "missing_key" as const });
    }
    return ok(undefined);
  };

  return {
    embeddingModel: (ref, credentials) => {
      const provider = parseModelRef(ref)?.provider;
      const checked = check(ref, provider, credentials?.provider === provider);
      if (!checked.ok) {
        return checked;
      }
      const model = embeddingModels[ref];
      return model
        ? ok(model)
        : err({ message: `no embedding model ${ref}`, type: "unsupported" });
    },

    languageModel: (ref, credentials) => {
      const provider = parseModelRef(ref)?.provider;
      const checked = check(ref, provider, credentials?.provider === provider);
      if (!checked.ok) {
        return checked;
      }
      const model = languageModels[ref];
      return model ? ok(model) : err({ selector: ref, type: "unknown_model" });
    },

    listModels: (keyedProviders) => {
      const available = (ref: ModelRef) => {
        const provider = parseModelRef(ref)?.provider ?? "";
        return keylessSet.has(provider) || keyedProviders.has(provider);
      };
      const aliased: ModelOption[] = Object.entries(aliases).map(
        ([alias, ref]) => ({
          available: available(ref),
          capabilities: [],
          contextWindow: null,
          label: alias,
          selector: alias,
          target: ref,
        })
      );
      const direct: ModelOption[] = Object.keys(languageModels).map((ref) => ({
        available: available(ref),
        capabilities: [],
        contextWindow: null,
        label: ref,
        selector: ref,
        target: ref,
      }));
      return [...aliased, ...direct];
    },

    resolve: (selector) => {
      if (selector === AUTO_MODEL) {
        return err({ selector, type: "unknown_model" });
      }
      const target = aliases[selector] ?? selector;
      const provider = parseModelRef(target)?.provider;
      if (!provider) {
        return err({ selector, type: "unknown_model" });
      }
      return providers.has(provider)
        ? ok(target)
        : err({ provider, type: "unknown_provider" });
    },
  };
};
