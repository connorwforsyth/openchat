import { createHash } from "node:crypto";

import { implement, ORPCError } from "@orpc/server";
import { instanceKeysFromConfig } from "@workspace/ai/keys/key-store.memory";
import type {
  ProviderCredentials,
  ProviderRegistry,
} from "@workspace/ai/ports/provider-registry";
import type { AppConfig } from "@workspace/config/schema";
import { contract } from "@workspace/contract/contract";
import { baseErrors, encryptionError } from "@workspace/contract/errors";
import type { ProviderKeyId, UserId } from "@workspace/contract/schemas/common";
import type { ProviderKey } from "@workspace/contract/schemas/keys";
import type { Db } from "@workspace/db/client";
import {
  createProviderKey,
  deleteProviderKey,
  getProviderKey,
  getSealedKey,
  type KeyScopeRef,
  listProviderKeysForScopes,
  type ProviderKeyRow,
  toProviderKey,
} from "@workspace/db/queries/provider-keys";
import { type CryptoError, type KeyRing, seal } from "@workspace/mcp/crypto";
import type { Result } from "@workspace/shared/result";

import type { RequestContext } from "../context";
import { openProviderKey, providerKeyAad } from "../keys/db-key-store";
import { createRegistryVerifier, type VerifyKey } from "../keys/verify";
import {
  administeredOrgs,
  administeredTeams,
  isInstanceAdmin,
  managesKeys,
} from "./roles";

// The `keys` procedure group (D17, D24): provider keys for users, teams and
// orgs. A key is sealed (AES-GCM) before it reaches the database and is
// never returned: callers see a label and the last four characters. A user
// manages their own keys; team keys need a team admin (or an org admin),
// org keys an org owner or admin. Instance keys live in app.config.yaml:
// instance admins see them (hint only) and can check them, nobody can add
// or delete them here.

export interface KeysDeps {
  /** For instance keys and for the providers a key may be added for. */
  readonly config: Pick<AppConfig, "providers">;
  readonly db: Db;
  /** From `loadKeyRing`; without one, keys can be listed but not added or opened. */
  readonly keys: Result<KeyRing, CryptoError>;
  /** Builds the model the default `verifyKey` checks a key with. */
  readonly registry: ProviderRegistry;
  /** Overrides the live check (tests pass a fake). */
  readonly verifyKey?: VerifyKey;
}

/**
 * A config key's id: stable across restarts and derived from the provider,
 * since the YAML has no ids. Shaped as a UUID (version 8, "custom").
 */
export const configKeyId = (provider: string): ProviderKeyId => {
  const hex = createHash("sha256").update(`instance:${provider}`).digest("hex");
  const variant = ((Number.parseInt(hex.charAt(16), 16) % 4) + 8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}` as ProviderKeyId;
};

const hintOf = (apiKey: string): string => apiKey.slice(-4);

const validation = (message: string, path: (string | number)[]) =>
  new ORPCError("VALIDATION", {
    data: { issues: [{ message, path }] },
    message: baseErrors.VALIDATION.message,
    status: baseErrors.VALIDATION.status,
  });
const forbidden = () => new ORPCError("FORBIDDEN", baseErrors.FORBIDDEN);
const notFound = () => new ORPCError("NOT_FOUND", baseErrors.NOT_FOUND);

export const createKeysRouter = (deps: KeysDeps) => {
  const { config, db } = deps;
  const verifyKey = deps.verifyKey ?? createRegistryVerifier(deps.registry);
  // Config keys have no creation time; the server's start stands in.
  const loadedAt = new Date().toISOString();
  const configKeys = (): readonly {
    readonly credentials: ProviderCredentials;
    readonly view: ProviderKey;
  }[] =>
    instanceKeysFromConfig(config).map((credentials) => ({
      credentials,
      view: {
        baseURL: credentials.baseURL ?? null,
        createdAt: loadedAt,
        createdBy: null,
        hint: hintOf(credentials.apiKey),
        id: configKeyId(credentials.provider),
        label: "",
        lastUsedAt: null,
        provider: credentials.provider,
        scope: { type: "instance" },
        source: "config",
      },
    }));

  const os = implement(contract).$context<RequestContext>();
  const authed = os.use(({ context, next }) => {
    if (!context.session) {
      throw new ORPCError("UNAUTHORIZED", baseErrors.UNAUTHORIZED);
    }
    return next({ context: { userId: context.session.userId } });
  });

  /** Every stored scope the user manages, for `list` with no scope. */
  const managedScopes = async (userId: UserId): Promise<KeyScopeRef[]> => {
    const [teams, orgs] = await Promise.all([
      administeredTeams(db, userId),
      administeredOrgs(db, userId),
    ]);
    return [
      { id: userId, type: "user" },
      ...teams.map((id): KeyScopeRef => ({ id, type: "team" })),
      ...orgs.map((id): KeyScopeRef => ({ id, type: "org" })),
    ];
  };

  type Found =
    | { readonly row: ProviderKeyRow; readonly type: "database" }
    | { readonly credentials: ProviderCredentials; readonly type: "config" };

  /** A key the caller manages; `NOT_FOUND` for anything else, so ids don't leak. */
  const managedKey = async (
    userId: UserId,
    id: ProviderKeyId
  ): Promise<Found> => {
    const found = await getProviderKey(db, id);
    if (found.ok) {
      const scope = { id: found.value.scopeId, type: found.value.scopeType };
      if (await managesKeys(db, userId, scope)) {
        return { row: found.value, type: "database" };
      }
      throw notFound();
    }
    const fromConfig = configKeys().find((key) => key.view.id === id);
    if (fromConfig && (await isInstanceAdmin(db, userId))) {
      return { credentials: fromConfig.credentials, type: "config" };
    }
    throw notFound();
  };

  const keys = {
    create: authed.keys.create.handler(async ({ context, input }) => {
      const scope: KeyScopeRef = input.scope;
      if (!(await managesKeys(db, context.userId, scope))) {
        throw forbidden();
      }
      if (!config.providers[input.provider]) {
        throw validation("This provider isn't configured on this instance.", [
          "provider",
        ]);
      }
      // Pasted keys often carry a trailing newline; no provider key has
      // meaningful surrounding whitespace.
      const apiKey = input.apiKey.trim();
      if (apiKey.length < 8) {
        throw validation("That doesn't look like an API key.", ["apiKey"]);
      }
      if (!deps.keys.ok) {
        // An operator's problem, not the user's: say so, typed (042).
        throw new ORPCError(
          "ENCRYPTION_UNAVAILABLE",
          encryptionError.ENCRYPTION_UNAVAILABLE
        );
      }
      const sealed = seal(deps.keys.value, apiKey, providerKeyAad(scope));
      const row = await createProviderKey(db, {
        baseUrl: input.baseURL ?? null,
        createdBy: context.userId,
        encryptedKey: sealed.ciphertext,
        hint: hintOf(apiKey),
        keyId: sealed.keyId,
        label: input.label,
        provider: input.provider,
        scope,
      });
      return toProviderKey(row);
    }),

    delete: authed.keys.delete.handler(async ({ context, input }) => {
      const found = await managedKey(context.userId, input.id);
      if (found.type === "config") {
        throw validation(
          "Instance keys live in app.config.yaml; remove them there.",
          ["id"]
        );
      }
      const deleted = await deleteProviderKey(
        db,
        { id: found.row.scopeId, type: found.row.scopeType },
        input.id
      );
      if (!deleted.ok) {
        throw notFound();
      }
    }),

    list: authed.keys.list.handler(async ({ context, input }) => {
      const { userId } = context;
      if (input.scopeId !== undefined && input.scopeType === undefined) {
        throw validation("`scopeId` needs a `scopeType`.", ["scopeType"]);
      }
      const stored = async (scopes: readonly KeyScopeRef[]) =>
        (await listProviderKeysForScopes(db, scopes)).map(toProviderKey);
      const scoped = async (scope: KeyScopeRef) => {
        if (!(await managesKeys(db, userId, scope))) {
          throw forbidden();
        }
        return stored([scope]);
      };
      const needScopeId = () => {
        if (input.scopeId === undefined) {
          throw validation("Name the team or org with `scopeId`.", ["scopeId"]);
        }
        return input.scopeId;
      };

      switch (input.scopeType) {
        case undefined: {
          const [own, admin] = await Promise.all([
            managedScopes(userId).then(stored),
            isInstanceAdmin(db, userId),
          ]);
          return [
            ...own,
            ...(admin ? configKeys().map((key) => key.view) : []),
          ];
        }
        case "instance":
          if (!(await isInstanceAdmin(db, userId))) {
            throw forbidden();
          }
          return configKeys().map((key) => key.view);
        case "user":
          return scoped({ id: input.scopeId ?? userId, type: "user" });
        case "team":
          return scoped({ id: needScopeId(), type: "team" });
        case "org":
          return scoped({ id: needScopeId(), type: "org" });
        default:
          return input.scopeType satisfies never;
      }
    }),

    verify: authed.keys.verify.handler(async ({ context, input, signal }) => {
      const found = await managedKey(context.userId, input.id);
      if (found.type === "config") {
        return verifyKey(found.credentials, { signal });
      }
      const scope = { id: found.row.scopeId, type: found.row.scopeType };
      const sealed = await getSealedKey(db, scope, input.id);
      if (!sealed.ok) {
        throw notFound();
      }
      const credentials = openProviderKey(deps.keys, {
        ...found.row,
        ...sealed.value,
      });
      if (!credentials.ok) {
        return {
          message:
            "This key can't be decrypted with the server's encryption keys; add it again.",
          ok: false,
        };
      }
      return verifyKey(credentials.value, { signal });
    }),
  };

  return { keys };
};
