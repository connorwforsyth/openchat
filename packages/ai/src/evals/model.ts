import type { LanguageModelV4 } from "@ai-sdk/provider";
import type { ProviderType } from "@workspace/config/schema";
import {
  type ModelRef,
  parseModelRef,
} from "@workspace/contract/schemas/models";
import { err, ok, type Result } from "@workspace/shared/result";

import { isKeyless, type ProviderFactoryOptions } from "../providers/factory";
import { buildRegistry, type RegistryConfig } from "../providers/registry";

// A model for the evals' live mode and judge, from app.config.yaml alone:
// an alias or `provider:model` ref, resolved as the app resolves it, paid by
// the instance key the YAML gives the provider (there's no chat context, so
// no personal or org key). Building one makes no network call.

/** What a selector points at, for the pre-flight summary. Never holds a key. */
export interface EvalModelTarget {
  /** Where the calls go: the configured `baseURL`, or `null` for the provider's own endpoint. */
  readonly baseURL: string | null;
  /** The provider has a key in the config (after `${ENV}` interpolation). */
  readonly hasKey: boolean;
  /** A local server that needs no key (Ollama, LM Studio, vLLM). */
  readonly keyless: boolean;
  readonly modelId: string;
  readonly provider: string;
  readonly ref: ModelRef;
  readonly selector: string;
  readonly type: ProviderType;
}

/** Resolves `selector` against the config, or says why it can't. Pure. */
export const describeEvalModel = (
  config: RegistryConfig,
  selector: string
): Result<EvalModelTarget, string> => {
  const resolved = buildRegistry(config).resolve(selector);
  if (!resolved.ok) {
    const { error } = resolved;
    return err(
      error.type === "unknown_provider"
        ? `"${selector}" names provider "${error.provider}", which isn't under \`providers\``
        : `"${selector}" is neither an alias in \`models.aliases\` nor a \`provider:model\` ref`
    );
  }
  const parsed = parseModelRef(resolved.value);
  const providerConfig = parsed ? config.providers[parsed.provider] : undefined;
  if (!(parsed && providerConfig)) {
    return err(`"${selector}" doesn't resolve to a configured provider`);
  }
  return ok({
    baseURL: providerConfig.baseURL ?? null,
    hasKey: Boolean(providerConfig.apiKey),
    keyless: isKeyless(providerConfig),
    modelId: parsed.modelId,
    provider: parsed.provider,
    ref: resolved.value,
    selector,
    type: providerConfig.type,
  });
};

/** The language model `target` names, with the config's instance key. */
export const evalLanguageModel = (
  config: RegistryConfig,
  target: EvalModelTarget,
  options: ProviderFactoryOptions = {}
): Result<LanguageModelV4, string> => {
  const apiKey = config.providers[target.provider]?.apiKey;
  const built = buildRegistry(config, options).languageModel(
    target.ref,
    apiKey
      ? { apiKey, provider: target.provider, source: { type: "instance" } }
      : undefined
  );
  if (built.ok) {
    return built;
  }
  const { error } = built;
  switch (error.type) {
    case "missing_key":
      return err(`provider "${error.provider}" has no apiKey in the config`);
    case "unknown_provider":
      return err(`provider "${error.provider}" isn't configured`);
    case "unknown_model":
      return err(`"${error.selector}" isn't a model ref`);
    case "unsupported":
      return err(error.message);
    default:
      return error satisfies never;
  }
};
