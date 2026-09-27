import type { KeyStore } from "@workspace/ai/keys/key-store";
import {
  instanceKeysFromConfig,
  withInstanceKeys,
} from "@workspace/ai/keys/key-store.memory";
import type { ProviderCredentials } from "@workspace/ai/ports/provider-registry";
import { loadOrgPolicy } from "@workspace/auth/resources";
import { clampOrgPolicy } from "@workspace/config/policy";
import type { AppConfig } from "@workspace/config/schema";
import type { OrgId, ProviderKeyId } from "@workspace/contract/schemas/common";
import type { KeyScope } from "@workspace/contract/schemas/keys";
import type { OrgPolicy } from "@workspace/contract/schemas/tenancy";
import type { Db } from "@workspace/db/client";
import {
  type KeyScopeRef,
  listSealedKeysForScopes,
  type SealedProviderKeyRow,
} from "@workspace/db/queries/provider-keys";
import { type CryptoError, type KeyRing, open } from "@workspace/mcp/crypto";
import { err, ok, type Result } from "@workspace/shared/result";

// The database side of the KeyStore port (D17, D24): org, team and user keys
// stored sealed in `provider_key`, opened here on the way into a provider
// call. Instance keys come from app.config.yaml, so `createKeyStore` wraps
// this with them and callers see one store.

/**
 * The purpose a provider key is sealed under, bound into the GCM tag. It
 * names the owning scope, so a sealed key copied to another user's, team's
 * or org's row fails to open. Never MCP's purposes.
 */
export const providerKeyAad = (scope: KeyScopeRef): string =>
  `provider_key:${scope.type}:${scope.id}`;

/** Why a stored key was left out. Carries the row id, never the key. */
export interface SkippedKey {
  readonly keyId: ProviderKeyId;
  readonly reason: CryptoError["type"];
}

export interface DbKeyStoreOptions {
  /** Told about each key that couldn't be opened; the store carries on without it. */
  readonly report?: (skipped: SkippedKey) => void;
}

const storedScope = (scope: KeyScope): KeyScopeRef | undefined =>
  scope.type === "instance" ? undefined : scope;

/** A stored key's owning scope, as the port names it. */
export const rowScope = (
  row: Pick<SealedProviderKeyRow, "scopeId" | "scopeType">
): KeyScope => ({ id: row.scopeId, type: row.scopeType }) as KeyScope;

/** Opens one stored key, or says why it can't be. */
export const openProviderKey = (
  keys: Result<KeyRing, CryptoError>,
  row: SealedProviderKeyRow
): Result<ProviderCredentials, CryptoError> => {
  if (!keys.ok) {
    return keys;
  }
  const scope = rowScope(row);
  const opened = open(
    keys.value,
    { ciphertext: row.encryptedKey, keyId: row.keyId },
    providerKeyAad({ id: row.scopeId, type: row.scopeType })
  );
  if (!opened.ok) {
    return opened;
  }
  return ok({
    apiKey: opened.value,
    ...(row.baseUrl ? { baseURL: row.baseUrl } : {}),
    provider: row.provider,
    source: scope,
  });
};

export const createDbKeyStore = (
  db: Db,
  keys: Result<KeyRing, CryptoError>,
  { report }: DbKeyStoreOptions = {}
): KeyStore => ({
  keysFor: async (scopes) => {
    const stored = scopes.flatMap((scope) => storedScope(scope) ?? []);
    let rows: SealedProviderKeyRow[];
    try {
      rows = await listSealedKeysForScopes(db, stored);
    } catch {
      // The port's one failure: the database is unreachable. The message is
      // ours, so no driver detail (or connection string) leaks into a run error.
      return err({
        message: "Stored provider keys couldn't be read.",
        type: "unavailable",
      });
    }
    const opened: ProviderCredentials[] = [];
    for (const row of rows) {
      const credentials = openProviderKey(keys, row);
      if (credentials.ok) {
        opened.push(credentials.value);
      } else {
        report?.({ keyId: row.id, reason: credentials.error.type });
      }
    }
    return ok(opened);
  },
});

/** The KeyStore the server runs on: stored keys from `db`, instance keys from config. */
export const createKeyStore = ({
  config,
  db,
  keys,
  report,
}: {
  readonly config: Pick<AppConfig, "providers">;
  readonly db: Db;
  readonly keys: Result<KeyRing, CryptoError>;
  readonly report?: DbKeyStoreOptions["report"];
}): KeyStore =>
  withInstanceKeys(
    createDbKeyStore(db, keys, { report }),
    instanceKeysFromConfig(config)
  );

/** What `resolveChatKeys` needs of an org's policy (`KeyPolicy.org`). */
export type OrgKeyPolicy = (
  orgId: OrgId
) => Promise<Pick<OrgPolicy, "personalKeyFallback">>;

/**
 * The org's effective key policy: its stored choice, clamped to the
 * instance limits (an org can't keep a fallback the instance has since
 * forbidden).
 */
export const orgKeyPolicy =
  (db: Db, config: Pick<AppConfig, "policies">): OrgKeyPolicy =>
  async (orgId) => {
    const { effective } = clampOrgPolicy(
      await loadOrgPolicy(db, orgId),
      config.policies
    );
    return { personalKeyFallback: effective.personalKeyFallback };
  };
