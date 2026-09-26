import { randomBytes } from "node:crypto";

import {
  auth,
  type OAuthClientInformation,
  type OAuthClientProvider,
  type OAuthTokens,
} from "@ai-sdk/mcp";
import type { FetchFunction } from "@ai-sdk/provider-utils";
import type { LibraryItemId, UserId } from "@workspace/contract/schemas/common";
import { type AsyncResult, err, ok } from "@workspace/shared/result";
import { z } from "zod";

import type { McpError } from "./errors";
import type { McpServerConfig } from "./server-config";

// MCP OAuth (ported from LibreChat's MCPOAuthHandler and MCPTokenStorage,
// rebuilt on `@ai-sdk/mcp`'s `auth()`, which already does discovery
// (RFC 9728 protected-resource metadata, then RFC 8414 / OIDC), dynamic
// client registration (RFC 7591), PKCE and refresh). What we add:
// - each user authorises for themselves; tokens are sealed per user and
//   server (`OAuthTokenStore`, backed by `mcp_oauth_token`);
// - a flow is bound to the user who started it and expires (CSRF);
// - a dynamically registered client is kept and reused, so signing in again
//   doesn't register a new client every time;
// - tokens are refreshed before they expire, and on a 401 by the transport.

const oauthTokensSchema = z.looseObject({
  access_token: z.string(),
  expires_in: z.number().optional(),
  refresh_token: z.string().optional(),
  scope: z.string().optional(),
  token_type: z.string(),
});

const oauthClientSchema = z.looseObject({
  client_id: z.string(),
  client_secret: z.string().optional(),
});

const authorizationServerSchema = z.object({
  authorizationServerUrl: z.string(),
  issuer: z.string().optional(),
  tokenEndpoint: z.string(),
});

/** What we keep for one user and one server (sealed as a whole). */
export const storedOAuthSchema = z.object({
  authorizationServer: authorizationServerSchema.optional(),
  client: oauthClientSchema.optional(),
  /** The client came from dynamic registration (so it may be re-registered). */
  dynamicClient: z.boolean().default(false),
  /** When `tokens` were issued, ms since the epoch: `expires_in` counts from here. */
  obtainedAt: z.number(),
  tokens: oauthTokensSchema,
});
export type StoredOAuth = z.infer<typeof storedOAuthSchema>;

/** Where tokens live between requests: `mcp_oauth_token` in production, memory in tests. */
export interface OAuthTokenStore {
  readonly load: (
    serverId: LibraryItemId,
    userId: UserId
  ) => AsyncResult<StoredOAuth | undefined, McpError>;
  readonly remove: (serverId: LibraryItemId, userId: UserId) => Promise<void>;
  readonly save: (
    serverId: LibraryItemId,
    userId: UserId,
    value: StoredOAuth
  ) => AsyncResult<void, McpError>;
}

export const expiresAtOf = (stored: StoredOAuth): Date | null =>
  stored.tokens.expires_in === undefined
    ? null
    : new Date(stored.obtainedAt + stored.tokens.expires_in * 1000);

/** Refresh this long before expiry, so a token doesn't lapse mid-run. */
const REFRESH_MARGIN_MS = 60_000;

export const isExpiring = (stored: StoredOAuth, now: number): boolean => {
  const expiresAt = expiresAtOf(stored);
  return expiresAt !== null && expiresAt.getTime() - REFRESH_MARGIN_MS <= now;
};

// --- Pending flows: between "start" and the callback ---

export const pendingFlowSchema = z.object({
  authorizationServer: authorizationServerSchema.optional(),
  client: oauthClientSchema.optional(),
  codeVerifier: z.string(),
  createdAt: z.number(),
  dynamicClient: z.boolean(),
  serverId: z.string(),
  state: z.string(),
  userId: z.string(),
});
export type PendingFlow = z.infer<typeof pendingFlowSchema>;

export interface OAuthFlowStore {
  readonly put: (flow: PendingFlow) => Promise<void>;
  /** Returns and forgets the flow: a state works once. */
  readonly take: (state: string) => Promise<PendingFlow | undefined>;
}

/** LibreChat's default flow TTL; long enough to sign in, short enough to forget. */
export const FLOW_TTL_MS = 15 * 60 * 1000;

/**
 * In-process flows. Fine for one server process; several replicas behind a
 * load balancer need a shared store with the same two functions.
 */
export const createMemoryFlowStore = (
  options: { readonly now?: () => number; readonly ttlMs?: number } = {}
): OAuthFlowStore => {
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? FLOW_TTL_MS;
  const flows = new Map<string, PendingFlow>();
  const sweep = () => {
    for (const [state, flow] of flows) {
      if (now() - flow.createdAt > ttlMs) {
        flows.delete(state);
      }
    }
  };
  return {
    put: (flow) => {
      sweep();
      flows.set(flow.state, flow);
      return Promise.resolve();
    },
    take: (state) => {
      sweep();
      const flow = flows.get(state);
      flows.delete(state);
      return Promise.resolve(flow);
    },
  };
};

export const createMemoryTokenStore = (): OAuthTokenStore & {
  readonly size: () => number;
} => {
  const values = new Map<string, StoredOAuth>();
  const key = (serverId: string, userId: string) => `${serverId}:${userId}`;
  return {
    load: (serverId, userId) =>
      Promise.resolve(ok(values.get(key(serverId, userId)))),
    remove: (serverId, userId) => {
      values.delete(key(serverId, userId));
      return Promise.resolve();
    },
    save: (serverId, userId, value) => {
      values.set(key(serverId, userId), value);
      return Promise.resolve(ok(undefined));
    },
    size: () => values.size,
  };
};

// --- The provider `auth()` and the transports call back into ---

export interface OAuthSettings {
  /** Shown on the authorization server's consent screen. */
  readonly clientName: string;
  /** Our callback route (mounted by the app; plain HTTP, not in the contract). */
  readonly redirectUrl: string;
}

/** Mutable on purpose: `auth()` writes into it as the flow advances. */
interface ProviderState {
  authorizationServer?: z.infer<typeof authorizationServerSchema>;
  client?: OAuthClientInformation;
  codeVerifier?: string;
  dynamicClient: boolean;
  redirectedTo?: URL;
  state?: string;
  tokens?: OAuthTokens;
}

const scopeOf = (server: McpServerConfig): string | undefined =>
  server.auth.type === "oauth" && server.auth.scopes.length > 0
    ? server.auth.scopes.join(" ")
    : undefined;

/**
 * An `OAuthClientProvider` over one piece of state. The SDK interface uses
 * getters and callbacks; a plain object satisfies it, no class needed.
 * `onTokens` runs whenever the SDK saves tokens (exchange or refresh).
 */
const createProvider = (
  settings: OAuthSettings,
  server: McpServerConfig,
  state: ProviderState,
  hooks: {
    readonly onInvalidate?: (
      scope: "all" | "client" | "tokens" | "verifier"
    ) => Promise<void>;
    readonly onTokens?: () => Promise<void>;
  } = {}
): OAuthClientProvider => ({
  authorizationServerInformation: () => state.authorizationServer,
  clientInformation: () => state.client,
  get clientMetadata() {
    return {
      client_name: settings.clientName,
      grant_types: ["authorization_code", "refresh_token"],
      redirect_uris: [settings.redirectUrl],
      response_types: ["code"],
      scope: scopeOf(server),
      // Public client with PKCE: there's no safe place for a client secret.
      token_endpoint_auth_method: "none",
    };
  },
  codeVerifier: () => {
    if (!state.codeVerifier) {
      throw new Error("No PKCE verifier for this flow");
    }
    return state.codeVerifier;
  },
  invalidateCredentials: async (scope) => {
    if (scope === "all" || scope === "tokens") {
      state.tokens = undefined;
    }
    if (scope === "all" || scope === "client") {
      state.client = undefined;
      state.dynamicClient = false;
    }
    await hooks.onInvalidate?.(scope);
  },
  isClientInformationDynamicallyRegistered: () => state.dynamicClient,
  redirectToAuthorization: (url) => {
    state.redirectedTo = url;
  },
  get redirectUrl() {
    return settings.redirectUrl;
  },
  saveAuthorizationServerInformation: (information) => {
    state.authorizationServer = information;
  },
  saveClientInformation: (client) => {
    state.client = client;
    state.dynamicClient = true;
  },
  saveCodeVerifier: (verifier) => {
    state.codeVerifier = verifier;
  },
  saveTokens: async (tokens) => {
    state.tokens = tokens;
    await hooks.onTokens?.();
  },
  state: () => {
    state.state ??= randomBytes(32).toString("base64url");
    return state.state;
  },
  storedState: () => state.state,
  tokens: () => state.tokens,
});

const toStored = (
  state: ProviderState,
  obtainedAt: number
): StoredOAuth | undefined => {
  const tokens = oauthTokensSchema.safeParse(state.tokens);
  if (!tokens.success) {
    return;
  }
  const client = oauthClientSchema.safeParse(state.client);
  return {
    authorizationServer: state.authorizationServer,
    client: client.success ? client.data : undefined,
    dynamicClient: state.dynamicClient,
    obtainedAt,
    tokens: tokens.data,
  };
};

export interface OAuthDeps {
  readonly fetch?: FetchFunction;
  readonly flows: OAuthFlowStore;
  readonly now: () => number;
  readonly settings: OAuthSettings;
  readonly store: OAuthTokenStore;
}

const failed = (message: string): McpError => ({
  message,
  type: "oauth_failed",
});

/**
 * Starts a sign-in: discovery, registration if needed, PKCE. Returns the
 * URL to send the user to; the flow waits for `completeAuthorization`.
 */
export const beginAuthorization = async (
  deps: OAuthDeps,
  server: McpServerConfig,
  userId: UserId
): AsyncResult<URL, McpError> => {
  if (server.auth.type !== "oauth") {
    return err({
      message: "This MCP server doesn't use OAuth.",
      type: "invalid_request",
    });
  }
  const existing = await deps.store.load(server.id, userId);
  // Keep the registered client (and its authorization server) across
  // sign-ins; only the tokens start over.
  const previous = existing.ok ? existing.value : undefined;
  const state: ProviderState = {
    authorizationServer: previous?.authorizationServer,
    client: previous?.client,
    dynamicClient: previous?.dynamicClient ?? false,
  };
  const provider = createProvider(deps.settings, server, state);
  try {
    const result = await auth(provider, {
      fetchFn: deps.fetch,
      scope: scopeOf(server),
      serverUrl: server.url,
    });
    if (result !== "REDIRECT" || !state.redirectedTo) {
      return err(failed("The MCP server didn't ask for a sign-in."));
    }
  } catch {
    return err(failed("Couldn't start signing in to this MCP server."));
  }
  if (!(state.state && state.codeVerifier)) {
    return err(failed("Couldn't start signing in to this MCP server."));
  }
  await deps.flows.put({
    authorizationServer: state.authorizationServer,
    client: oauthClientSchema.safeParse(state.client).data,
    codeVerifier: state.codeVerifier,
    createdAt: deps.now(),
    dynamicClient: state.dynamicClient,
    serverId: server.id,
    state: state.state,
    userId,
  });
  return ok(state.redirectedTo);
};

export const callbackInputSchema = z.object({
  code: z.string().min(1),
  /** RFC 9207 issuer, when the authorization server sends it. */
  iss: z.string().optional(),
  state: z.string().min(1),
});
export type CallbackInput = z.infer<typeof callbackInputSchema>;

/**
 * The callback: checks the flow belongs to this user, exchanges the code
 * (PKCE) and stores the tokens sealed. Returns the server it was for.
 */
export const completeAuthorization = async (
  deps: OAuthDeps,
  resolveServer: (id: LibraryItemId) => AsyncResult<McpServerConfig, McpError>,
  input: CallbackInput,
  userId: UserId
): AsyncResult<LibraryItemId, McpError> => {
  const flow = await deps.flows.take(input.state);
  if (!flow) {
    return err(failed("This sign-in link has expired. Start again."));
  }
  // A callback carried into someone else's session is a CSRF attempt.
  if (flow.userId !== userId) {
    return err(failed("This sign-in was started by someone else."));
  }
  const server = await resolveServer(flow.serverId as LibraryItemId);
  if (!server.ok) {
    return server;
  }
  const state: ProviderState = {
    authorizationServer: flow.authorizationServer,
    client: flow.client,
    codeVerifier: flow.codeVerifier,
    dynamicClient: flow.dynamicClient,
    state: flow.state,
  };
  try {
    await auth(createProvider(deps.settings, server.value, state), {
      authorizationCode: input.code,
      callbackIssuer: input.iss,
      callbackState: input.state,
      fetchFn: deps.fetch,
      serverUrl: server.value.url,
    });
  } catch {
    return err(failed("The MCP server didn't accept the sign-in."));
  }
  const stored = toStored(state, deps.now());
  if (!stored) {
    return err(failed("The MCP server didn't return a usable token."));
  }
  const saved = await deps.store.save(server.value.id, userId, stored);
  return saved.ok ? ok(server.value.id) : saved;
};

/**
 * The provider a connection's transport uses: current tokens in, refreshed
 * tokens saved back sealed. It never starts a sign-in; if the grant is gone
 * the connection reports `needs_auth` and the user starts one.
 */
export const connectionAuth = (
  deps: Pick<OAuthDeps, "now" | "settings" | "store">,
  server: McpServerConfig,
  userId: UserId,
  stored: StoredOAuth
): {
  readonly provider: OAuthClientProvider;
  /** True once the SDK wanted to send the user to sign in. */
  readonly wantsSignIn: () => boolean;
} => {
  const state: ProviderState = {
    authorizationServer: stored.authorizationServer,
    client: stored.client,
    dynamicClient: stored.dynamicClient,
    tokens: stored.tokens,
  };
  const provider = createProvider(deps.settings, server, state, {
    onInvalidate: async (scope) => {
      if (scope === "all" || scope === "tokens") {
        await deps.store.remove(server.id, userId);
      }
    },
    onTokens: async () => {
      const next = toStored(state, deps.now());
      if (next) {
        await deps.store.save(server.id, userId, next);
      }
    },
  });
  return { provider, wantsSignIn: () => state.redirectedTo !== undefined };
};

/**
 * Refreshes tokens that are about to expire, before a connection uses them.
 * `false` means the grant is gone and the user must sign in again.
 */
export const refreshIfExpiring = async (
  deps: Pick<OAuthDeps, "fetch" | "now" | "settings" | "store">,
  server: McpServerConfig,
  userId: UserId,
  stored: StoredOAuth
): Promise<boolean> => {
  if (!isExpiring(stored, deps.now())) {
    return true;
  }
  if (!stored.tokens.refresh_token) {
    return false;
  }
  const { provider, wantsSignIn } = connectionAuth(
    deps,
    server,
    userId,
    stored
  );
  try {
    const result = await auth(provider, {
      fetchFn: deps.fetch,
      serverUrl: server.url,
    });
    return result === "AUTHORIZED" && !wantsSignIn();
  } catch {
    return false;
  }
};
