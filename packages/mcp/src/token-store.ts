import type { Db } from "@workspace/db/client";
import {
  deleteMcpOauthToken,
  getMcpOauthToken,
  upsertMcpOauthToken,
} from "@workspace/db/queries/mcp";
import { err, ok, type Result } from "@workspace/shared/result";

import {
  type CryptoError,
  isStale,
  type KeyRing,
  mcpOauthTokenAad,
  open,
  seal,
} from "./crypto";
import type { McpError } from "./errors";
import {
  expiresAtOf,
  type OAuthTokenStore,
  type StoredOAuth,
  storedOAuthSchema,
} from "./oauth";

// OAuth tokens in `mcp_oauth_token`, sealed per user and server (D24). The
// whole record (tokens, the registered client, the authorization server it
// belongs to) is one ciphertext, bound to its row by the AAD, so a
// ciphertext moved to another user's row won't open.

const secretsUnavailable = (error: CryptoError): McpError => ({
  message:
    error.type === "missing_key" || error.type === "invalid_key"
      ? error.message
      : "Stored MCP credentials can't be read.",
  type: "secrets_unavailable",
});

export const createDbTokenStore = (
  db: Db,
  keys: Result<KeyRing, CryptoError>
): OAuthTokenStore => {
  const save: OAuthTokenStore["save"] = async (serverId, userId, value) => {
    if (!keys.ok) {
      return err(secretsUnavailable(keys.error));
    }
    const sealed = seal(
      keys.value,
      JSON.stringify(value),
      mcpOauthTokenAad(serverId, userId)
    );
    await upsertMcpOauthToken(db, {
      ciphertext: sealed.ciphertext,
      expiresAt: expiresAtOf(value),
      keyId: sealed.keyId,
      mcpServerId: serverId,
      userId,
    });
    return ok(undefined);
  };

  return {
    load: async (serverId, userId) => {
      if (!keys.ok) {
        return err(secretsUnavailable(keys.error));
      }
      const row = await getMcpOauthToken(db, serverId, userId);
      if (!row) {
        return ok(undefined);
      }
      const opened = open(keys.value, row, mcpOauthTokenAad(serverId, userId));
      // Sealed under a key that's gone, or corrupted: the user signs in
      // again, which beats an error they can't fix.
      if (!opened.ok) {
        return ok(undefined);
      }
      let parsed: StoredOAuth | undefined;
      try {
        parsed = storedOAuthSchema.safeParse(JSON.parse(opened.value)).data;
      } catch {
        parsed = undefined;
      }
      if (parsed && isStale(keys.value, row)) {
        await save(serverId, userId, parsed);
      }
      return ok(parsed);
    },
    remove: async (serverId, userId) => {
      await deleteMcpOauthToken(db, serverId, userId);
    },
    save,
  };
};
