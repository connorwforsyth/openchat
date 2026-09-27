import type { ProviderV4 } from "@ai-sdk/provider";
import type { AppConfig } from "@workspace/config/schema";
import {
  AUTO_MODEL,
  type ModelOption,
  type ModelRef,
  parseModelRef,
} from "@workspace/contract/schemas/models";
import { err, ok, type Result, tryCatch } from "@workspace/shared/result";

import type {
  ProviderCredentials,
  ProviderRegistry,
  ProviderRegistryError,
} from "../ports/provider-registry";
import { type ModelCapability, providerCapabilities } from "./capabilities";
import {
  createProvider,
  isKeyless,
  type ProviderFactoryOptions,
} from "./factory";

// The config-driven ProviderRegistry (D3): app.config.yaml `providers` and
// `models.aliases` in, AI SDK models out. It implements the port rather than
// returning the SDK's `createProviderRegistry`, because the port takes the
// key per call (keys depend on the chat context, D17) and resolves aliases to
// refs the run records as `resolvedModel`.

export type RegistryConfig = Pick<AppConfig, "models" | "providers">;

type ModelKind = "embeddingModel" | "languageModel";

export const buildRegistry = (
  config: RegistryConfig,
  options: ProviderFactoryOptions = {}
): ProviderRegistry => {
  const { aliases } = config.models;

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

  // `auto` ends may be aliases; the picker shows the ref each resolves to.
  const refOf = (selector: string | null): ModelRef | null => {
    if (!selector) {
      return null;
    }
    const resolved = resolve(selector);
    return resolved.ok ? resolved.value : null;
  };

  return {
    embeddingModel: (ref, credentials) =>
      model("embeddingModel", ref, credentials),

    languageModel: (ref, credentials) =>
      model("languageModel", ref, credentials),

    listModels: (keyedProviders) => {
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
    },

    resolve,
  };
};
