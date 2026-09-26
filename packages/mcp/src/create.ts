import type { AppConfig } from "@workspace/config/schema";
import type { Db } from "@workspace/db/client";

import { type KeyRingEnv, loadKeyRing } from "./crypto";
import { createMcpManager, type McpManager } from "./manager";
import { createServerRegistry, type ServerRegistry } from "./registry";
import { createDbTokenStore } from "./token-store";

// Wiring for the app shell (ticket 025): one manager per process, from the
// loaded config, the database (if any) and the environment. Every input is
// optional in the sense that matters: no database means instance servers
// only, no callback URL means OAuth servers say OAuth isn't configured, and
// a missing ENCRYPTION_KEY in production turns off only what needs secrets.

export interface CreateMcpOptions {
  /** Let library servers reach the private network (a trusted, single-user dev box). */
  readonly allowPrivateNetworks?: boolean;
  readonly config: Pick<AppConfig, "brand" | "mcp">;
  readonly db?: Db;
  readonly env: KeyRingEnv;
  /** Absolute URL of the OAuth callback route, e.g. `${origin}/api/mcp/oauth/callback`. */
  readonly oauthRedirectUrl?: string;
  readonly warn?: (message: string) => void;
}

export interface Mcp {
  readonly manager: McpManager;
  readonly registry: ServerRegistry;
}

export const createMcp = (options: CreateMcpOptions): Mcp => {
  const keys = loadKeyRing(options.env, { warn: options.warn });
  if (!keys.ok && "message" in keys.error) {
    options.warn?.(keys.error.message);
  }
  const registry = createServerRegistry({
    config: options.config.mcp,
    db: options.db,
  });
  const clientName = options.config.brand.name;
  const manager = createMcpManager({
    allowPrivateNetworks: options.allowPrivateNetworks,
    clientName,
    keys,
    oauth:
      options.db && options.oauthRedirectUrl
        ? {
            settings: { clientName, redirectUrl: options.oauthRedirectUrl },
            store: createDbTokenStore(options.db, keys),
          }
        : undefined,
    resolveServer: registry.resolve,
  });
  return { manager, registry };
};
