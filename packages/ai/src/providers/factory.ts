import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createAzure } from "@ai-sdk/azure";
import { createGoogle } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { ProviderV4 } from "@ai-sdk/provider";
import type { ProviderConfig } from "@workspace/config/schema";
import { err, ok, type Result } from "@workspace/shared/result";

import type {
  ProviderCredentials,
  ProviderRegistryError,
} from "../ports/provider-registry";

// One AI SDK provider instance per (config, key) pair (D3). Building one makes
// no network call, so this runs per request without caching. The key always
// comes from `resolveChatKeys` (D17): a key written in app.config.yaml is an
// *instance* key and pays only where the policy allows, so it's never read
// here directly.

export type FetchFunction = typeof globalThis.fetch;

export interface ProviderFactoryOptions {
  /** Replaces `fetch` for every provider; tests pass one that fails loudly. */
  readonly fetch?: FetchFunction;
}

/**
 * An `openai-compatible` provider without an `apiKey` in the YAML is treated
 * as a local server (Ollama, LM Studio, vLLM) that needs no key. A key that
 * resolves for it anyway is still sent. Set `options.keyless: "false"` for a
 * hosted gateway where every user brings their own key.
 */
export const isKeyless = (config: ProviderConfig): boolean =>
  config.type === "openai-compatible" &&
  !config.apiKey &&
  config.options.keyless !== "false";

const missingKey = (provider: string): Result<never, ProviderRegistryError> =>
  err({ provider, type: "missing_key" });

/** Builds the provider `id` from its config and the key picked for this call. */
export const createProvider = (
  id: string,
  config: ProviderConfig,
  credentials: ProviderCredentials | undefined,
  { fetch }: ProviderFactoryOptions = {}
): Result<ProviderV4, ProviderRegistryError> => {
  // A key for another provider is no key at all; never send it elsewhere.
  const key = credentials?.provider === id ? credentials : undefined;
  if (!(key || isKeyless(config))) {
    return missingKey(id);
  }
  const shared = {
    apiKey: key?.apiKey,
    baseURL: key?.baseURL ?? config.baseURL,
    fetch,
    headers: config.headers,
  };

  switch (config.type) {
    case "openai":
      return ok(createOpenAI(shared));
    case "anthropic":
      return ok(createAnthropic(shared));
    case "google":
      return ok(createGoogle(shared));
    case "azure":
      return ok(
        createAzure({
          ...shared,
          apiVersion: config.options.apiVersion,
          resourceName: config.options.resourceName,
        })
      );
    case "bedrock":
      // Bedrock API keys (bearer tokens) only: AWS access-key pairs would
      // need a second secret the key store doesn't model.
      return ok(
        createAmazonBedrock({ ...shared, region: config.options.region })
      );
    case "openai-compatible": {
      const { baseURL } = shared;
      if (!baseURL) {
        return err({
          message: `provider "${id}" has no baseURL`,
          type: "unsupported",
        });
      }
      return ok(
        createOpenAICompatible({
          ...shared,
          baseURL,
          includeUsage: true,
          name: id,
        })
      );
    }
    default:
      return config.type satisfies never;
  }
};
