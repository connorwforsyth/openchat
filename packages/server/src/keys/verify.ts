import type {
  ProviderCredentials,
  ProviderRegistry,
} from "@workspace/ai/ports/provider-registry";
import type { verifyProviderKeyOutputSchema } from "@workspace/contract/schemas/keys";
import { parseModelRef } from "@workspace/contract/schemas/models";
import { APICallError } from "ai";
import type { z } from "zod";

// `keys.verify`: a cheap live check that a provider accepts a key. The check
// is a port so tests (and the API tests) never reach a provider; the default
// makes the smallest call it can through the provider registry.

export type VerifyResult = z.infer<typeof verifyProviderKeyOutputSchema>;

export type VerifyKey = (
  credentials: ProviderCredentials,
  options?: { readonly signal?: AbortSignal }
) => Promise<VerifyResult>;

const REJECTED = new Set([401, 403]);

/**
 * A provider's own error text can quote the key back (some echo a prefix),
 * so the message shown is ours, chosen by status.
 */
const safeMessage = (error: unknown): string => {
  if (APICallError.isInstance(error) && error.statusCode !== undefined) {
    if (REJECTED.has(error.statusCode)) {
      return "The provider rejected this key.";
    }
    if (error.statusCode === 429) {
      return "The provider is rate-limiting this key; try again shortly.";
    }
  }
  return "The provider couldn't be reached to check this key.";
};

/**
 * Checks a key with a one-token completion on the first model the config
 * offers for its provider.
 */
export const createRegistryVerifier =
  (
    registry: ProviderRegistry,
    { timeoutMs = 15_000 }: { readonly timeoutMs?: number } = {}
  ): VerifyKey =>
  async (credentials, options = {}) => {
    // With `discover: true` this reads the catalog with the key being
    // checked, so a provider with no `models` still has one to try.
    const listed = await registry.listModels(
      { [credentials.provider]: credentials },
      { signal: options.signal }
    );
    const target = listed
      .map((option) => option.target)
      .find(
        (ref) =>
          ref !== null && parseModelRef(ref)?.provider === credentials.provider
      );
    if (!target) {
      return {
        message:
          "No model is configured for this provider to check the key with.",
        ok: false,
      };
    }
    const model = registry.languageModel(target, credentials);
    if (!model.ok) {
      return {
        message: "This provider isn't configured on the server.",
        ok: false,
      };
    }
    const timeout = AbortSignal.timeout(timeoutMs);
    try {
      await model.value.doGenerate({
        abortSignal: options.signal
          ? AbortSignal.any([options.signal, timeout])
          : timeout,
        maxOutputTokens: 1,
        prompt: [{ content: [{ text: "Hi", type: "text" }], role: "user" }],
      });
      return { message: null, ok: true };
    } catch (error) {
      return { message: safeMessage(error), ok: false };
    }
  };
