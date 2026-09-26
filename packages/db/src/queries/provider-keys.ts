import type { ProviderKeyId, UserId } from "@workspace/contract/schemas/common";
import type { ProviderKey } from "@workspace/contract/schemas/keys";
import type { ProviderId } from "@workspace/contract/schemas/models";
import { type AsyncResult, err, ok } from "@workspace/shared/result";
import { and, asc, eq, getColumns, ne, or } from "drizzle-orm";

import type { Db } from "../client";
import { type NotFoundError, notFound } from "../errors";
import type { PrincipalId } from "../schema/columns";
import { type KEY_SCOPE_TYPES, providerKey } from "../schema/usage";

// Provider keys (D17, D24). Keys arrive here already sealed (AES-GCM under
// ENCRYPTION_KEY, done by the caller); the database never sees a plaintext
// key. Reads return the public fields only, except `getSealedKey`, which the
// key resolver calls right before decrypting.

const { encryptedKey: _encryptedKey, ...publicColumns } =
  getColumns(providerKey);

export type ProviderKeyRow = Omit<
  typeof providerKey.$inferSelect,
  "encryptedKey"
>;

export interface KeyScopeRef {
  readonly id: PrincipalId;
  readonly type: (typeof KEY_SCOPE_TYPES)[number];
}

export interface NewProviderKey {
  readonly baseUrl?: string | null;
  readonly createdBy: UserId;
  /** The sealed key, never the plaintext. */
  readonly encryptedKey: string;
  /** Last four characters of the plaintext, for recognising it. */
  readonly hint: string;
  /** Which encryption key sealed it. */
  readonly keyId: string;
  readonly label?: string;
  readonly provider: ProviderId;
  readonly scope: KeyScopeRef;
}

export const createProviderKey = async (
  db: Db,
  input: NewProviderKey
): Promise<ProviderKeyRow> => {
  const [row] = await db
    .insert(providerKey)
    .values({
      baseUrl: input.baseUrl ?? null,
      createdBy: input.createdBy,
      encryptedKey: input.encryptedKey,
      hint: input.hint,
      keyId: input.keyId,
      label: input.label ?? "",
      provider: input.provider,
      scopeId: input.scope.id,
      scopeType: input.scope.type,
    })
    .returning(publicColumns);
  if (!row) {
    throw new Error("insert returned no row");
  }
  return row;
};

export const listProviderKeys = (
  db: Db,
  scope?: KeyScopeRef
): Promise<ProviderKeyRow[]> =>
  db
    .select(publicColumns)
    .from(providerKey)
    .where(
      scope
        ? and(
            eq(providerKey.scopeType, scope.type),
            eq(providerKey.scopeId, scope.id)
          )
        : undefined
    )
    .orderBy(asc(providerKey.createdAt));

/**
 * Keys for `provider` held by any of `scopes`, in the order the scopes are
 * given, so `resolveChatKeys` can pass the chain (team, its ancestors, the
 * org, then the user) and take the first.
 */
export const findKeysForScopes = async (
  db: Db,
  provider: ProviderId,
  scopes: readonly KeyScopeRef[]
): Promise<ProviderKeyRow[]> => {
  if (scopes.length === 0) {
    return [];
  }
  const rows = await db
    .select(publicColumns)
    .from(providerKey)
    .where(
      and(
        eq(providerKey.provider, provider),
        or(
          ...scopes.map((scope) =>
            and(
              eq(providerKey.scopeType, scope.type),
              eq(providerKey.scopeId, scope.id)
            )
          )
        )
      )
    )
    .orderBy(asc(providerKey.createdAt));
  const rank = (row: ProviderKeyRow) =>
    scopes.findIndex(
      (scope) => scope.type === row.scopeType && scope.id === row.scopeId
    );
  return [...rows].sort((a, b) => rank(a) - rank(b));
};

export interface SealedKey {
  readonly encryptedKey: string;
  readonly keyId: string;
}

/** The sealed key, for decrypting just before use. Never log or return it. */
export const getSealedKey = async (
  db: Db,
  id: ProviderKeyId
): AsyncResult<SealedKey, NotFoundError> => {
  const [row] = await db
    .select({
      encryptedKey: providerKey.encryptedKey,
      keyId: providerKey.keyId,
    })
    .from(providerKey)
    .where(eq(providerKey.id, id));
  return row ? ok(row) : err(notFound("provider_key", id));
};

export const touchProviderKey = async (
  db: Db,
  id: ProviderKeyId,
  now: Date = new Date()
): Promise<void> => {
  await db
    .update(providerKey)
    .set({ lastUsedAt: now })
    .where(eq(providerKey.id, id));
};

/** Keys still sealed with something other than `currentKeyId`: what rotation must reseal. */
export const listKeysToReseal = (
  db: Db,
  currentKeyId: string
): Promise<ProviderKeyRow[]> =>
  db
    .select(publicColumns)
    .from(providerKey)
    .where(ne(providerKey.keyId, currentKeyId));

export const resealProviderKey = async (
  db: Db,
  id: ProviderKeyId,
  sealed: SealedKey
): AsyncResult<ProviderKeyRow, NotFoundError> => {
  const [row] = await db
    .update(providerKey)
    .set({ encryptedKey: sealed.encryptedKey, keyId: sealed.keyId })
    .where(eq(providerKey.id, id))
    .returning(publicColumns);
  return row ? ok(row) : err(notFound("provider_key", id));
};

export const deleteProviderKey = async (
  db: Db,
  id: ProviderKeyId
): AsyncResult<void, NotFoundError> => {
  const deleted = await db
    .delete(providerKey)
    .where(eq(providerKey.id, id))
    .returning({ id: providerKey.id });
  return deleted.length > 0 ? ok(undefined) : err(notFound("provider_key", id));
};

/** A row as the contract's `ProviderKey` (database keys only; config keys are the server's). */
export const toProviderKey = (row: ProviderKeyRow): ProviderKey => ({
  baseURL: row.baseUrl,
  createdAt: row.createdAt.toISOString(),
  createdBy: row.createdBy,
  hint: row.hint,
  id: row.id,
  label: row.label,
  lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  provider: row.provider,
  scope: { id: row.scopeId, type: row.scopeType } as ProviderKey["scope"],
  source: "database",
});
