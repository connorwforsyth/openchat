import type { AppConfig } from "@workspace/config/schema";
import type { KeyScope } from "@workspace/contract/schemas/keys";
import { ok } from "@workspace/shared/result";

import type { ProviderCredentials } from "../ports/provider-registry";
import { type KeyStore, sameScope } from "./key-store";

// A KeyStore over a list held in memory: the fake for tests, and the home of
// instance keys, which live in app.config.yaml rather than the database.

export const createMemoryKeyStore = (
  keys: readonly ProviderCredentials[]
): KeyStore => ({
  keysFor: (scopes) =>
    Promise.resolve(
      ok(
        keys.filter((key) =>
          scopes.some((scope) => sameScope(scope, key.source))
        )
      )
    ),
});

/** The `apiKey`s written under `providers` in app.config.yaml, as instance keys. */
export const instanceKeysFromConfig = (
  config: Pick<AppConfig, "providers">
): readonly ProviderCredentials[] =>
  Object.entries(config.providers).flatMap(([provider, providerConfig]) =>
    providerConfig.apiKey
      ? [
          {
            apiKey: providerConfig.apiKey,
            baseURL: providerConfig.baseURL,
            provider,
            source: { type: "instance" } as const,
          },
        ]
      : []
  );

const isInstance = (scope: KeyScope): boolean => scope.type === "instance";

/**
 * Serves instance keys from config and every other scope from `store` (the
 * database adapter), so callers see one KeyStore.
 */
export const withInstanceKeys = (
  store: KeyStore,
  instanceKeys: readonly ProviderCredentials[]
): KeyStore => ({
  keysFor: async (scopes, options) => {
    const stored = scopes.filter((scope) => !isInstance(scope));
    const fromStore =
      stored.length > 0 ? await store.keysFor(stored, options) : ok([]);
    if (!fromStore.ok) {
      return fromStore;
    }
    return ok([
      ...fromStore.value,
      ...(scopes.some(isInstance) ? instanceKeys : []),
    ]);
  },
});
