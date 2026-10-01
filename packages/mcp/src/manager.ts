import {
  createMCPClient,
  type ListToolsResult,
  type MCPClient,
} from "@ai-sdk/mcp";
import {
  type FetchFunction,
  fetchWithValidatedEndpoint,
} from "@ai-sdk/provider-utils";
import type { McpToolSource } from "@workspace/ai/tools/tool-set";
import type { LibraryItemId, UserId } from "@workspace/contract/schemas/common";
import type {
  McpConnectionStatus,
  McpTool,
} from "@workspace/contract/schemas/library";
import type { Db } from "@workspace/db/client";
import { listGrantsForPrincipals } from "@workspace/db/queries/grants";
import { listMcpServers } from "@workspace/db/queries/library";
import { loadPrincipals } from "@workspace/db/queries/teams";
import {
  type AsyncResult,
  err,
  ok,
  type Result,
} from "@workspace/shared/result";
import type { Tool, ToolExecutionOptions, ToolSet } from "ai";

import {
  type CryptoError,
  type KeyRing,
  MCP_HEADER_SECRET_AAD,
  open,
} from "./crypto";
import {
  describeError,
  type McpError,
  toStatus,
  toToolError,
  unavailable,
} from "./errors";
import {
  backoffDelay,
  type CircuitPolicy,
  type CircuitState,
  classifyError,
  closedCircuit,
  DEFAULT_CIRCUIT,
  DEFAULT_RECONNECT,
  DEFAULT_TIMEOUTS,
  isCircuitOpen,
  isConnectionLost,
  isRateLimited,
  type ReconnectPolicy,
  recordFailedRound,
  type Timeouts,
  wasNotDelivered,
} from "./lifecycle";
import {
  beginAuthorization,
  type CallbackInput,
  completeAuthorization,
  connectionAuth,
  createMemoryFlowStore,
  type OAuthDeps,
  type OAuthFlowStore,
  type OAuthSettings,
  type OAuthTokenStore,
  refreshIfExpiring,
} from "./oauth";
import {
  checkServerUrl,
  connectionKey,
  isPerUser,
  type McpServerConfig,
} from "./server-config";
import { isToolAllowed, namespacedToolName, safeToolName } from "./tool-names";

// The connection manager: LibreChat's MCPManager, UserConnectionManager and
// ConnectionsRepository folded into one set of closures over a map of
// connections. It's the imperative shell around the pure policy in
// `lifecycle.ts` and the mappings in `server-config.ts`:
// - one shared connection per instance/org/team server, one per user for
//   OAuth or user-owned servers (`connectionKey`);
// - concurrent callers join the connection attempt in flight;
// - a server whose definition changed gets a fresh connection;
// - a dropped connection reconnects on next use with backoff, and a server
//   that keeps failing trips a breaker instead of being hammered;
// - idle per-user connections are closed after a while;
// - tools are listed once per connection and exposed as `server__tool`.

export interface McpManagerOptions {
  /** Library servers may point at the private network (development, tests). */
  readonly allowPrivateNetworks?: boolean;
  readonly circuit?: Partial<CircuitPolicy>;
  /** Sent in `initialize` and shown on OAuth consent screens (the brand name). */
  readonly clientName: string;
  /** Server-side fetch override (tests); otherwise untrusted URLs are DNS-pinned. */
  readonly fetch?: FetchFunction;
  /** Per-user connections close after this long unused. LibreChat: 15 min. */
  readonly idleTimeoutMs?: number;
  /** Opens header secrets. A missing key degrades those servers only. */
  readonly keys?: Result<KeyRing, CryptoError>;
  /** Tools kept per server (LibreChat caps discovery the same way). */
  readonly maxTools?: number;
  readonly now?: () => number;
  /** Leave out and OAuth servers report that OAuth isn't configured. */
  readonly oauth?: {
    readonly flows?: OAuthFlowStore;
    readonly settings: OAuthSettings;
    readonly store: OAuthTokenStore;
  };
  readonly random?: () => number;
  readonly reconnect?: Partial<ReconnectPolicy>;
  readonly resolveServer: (
    id: LibraryItemId
  ) => AsyncResult<McpServerConfig, McpError>;
  readonly sleep?: (ms: number) => Promise<void>;
  /** How often to look for idle connections; 0 turns the sweep off. */
  readonly sweepIntervalMs?: number;
  readonly timeouts?: Partial<Timeouts>;
}

export interface McpManager {
  /** Drops every connection. For shutdown and tests. */
  readonly close: () => Promise<void>;
  /** The OAuth callback: exchanges the code and stores the tokens. */
  readonly completeOAuth: (
    input: CallbackInput,
    userId: UserId
  ) => AsyncResult<LibraryItemId, McpError>;
  /** Forgets the user's tokens for a server and closes their connection. */
  readonly disconnectOAuth: (
    id: LibraryItemId,
    userId: UserId
  ) => Promise<void>;
  /** Closes per-user connections unused for `idleTimeoutMs`; returns how many. */
  readonly evictIdle: () => Promise<number>;
  readonly listTools: (
    id: LibraryItemId,
    userId: UserId
  ) => AsyncResult<readonly McpTool[], McpError>;
  /** How many connections are open, for health checks. */
  readonly openConnections: () => number;
  readonly resolveServer: McpManagerOptions["resolveServer"];
  readonly startOAuth: (
    id: LibraryItemId,
    userId: UserId
  ) => AsyncResult<URL, McpError>;
  readonly status: (
    id: LibraryItemId,
    userId: UserId
  ) => Promise<McpConnectionStatus>;
  /** The `McpToolSource` for one user's run (`buildToolSet`). */
  readonly toolSource: (userId: UserId) => McpToolSource;
}

export interface UsableServersDeps {
  /** `undefined` without a database: only instance servers exist then. */
  readonly db?: Db;
  /** The servers from app.config.yaml (`ServerRegistry.instanceServers`). */
  readonly instanceServers: readonly Pick<McpServerConfig, "id">[];
}

/**
 * Every server `userId` may `use`, for a plain chat, which has no agent
 * version to name them (078): the instance's, those owned by the user or by
 * a team or org they're in, and those shared with any of them. It's
 * `canUseServer`'s rule (`handlers.ts`) turned into a list, no wider: an
 * agent still gets only the servers its version lists.
 */
export const listUsableServers = async (
  { db, instanceServers }: UsableServersDeps,
  userId: UserId
): Promise<readonly LibraryItemId[]> => {
  const instance = instanceServers.map((server) => server.id);
  if (!db) {
    return instance;
  }
  const principals = await loadPrincipals(db, userId);
  const [owned, granted] = await Promise.all([
    Promise.all(principals.map((principal) => listMcpServers(db, principal))),
    listGrantsForPrincipals(db, principals, { resourceType: "mcp_server" }),
  ]);
  return [
    ...new Set([
      ...instance,
      ...owned.flat().map((row) => row.id),
      ...granted.map((grant) => grant.resourceId as LibraryItemId),
    ]),
  ];
};

interface Live {
  readonly client: MCPClient;
  readonly definitions: ListToolsResult;
}

/** One connection's state. Mutable: this is the shell. */
interface Entry {
  circuit: CircuitState;
  disposed: boolean;
  everConnected: boolean;
  /** Bumped per connect, so callbacks from an old client can't touch a new one. */
  generation: number;
  readonly key: string;
  lastError?: McpError;
  lastUsed: number;
  live?: Live;
  lost: boolean;
  pending?: Promise<Result<Live, McpError>>;
  readonly perUser: boolean;
  readonly version: string;
}

const MAX_TOOL_PAGES = 50;
const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
const SWEEP_INTERVAL_MS = 60 * 1000;

/** Failures a retry can't fix: wait for a person, not a backoff. */
const FINAL: ReadonlySet<McpError["type"]> = new Set([
  "blocked_url",
  "needs_auth",
  "not_found",
  "oauth_unavailable",
  "secrets_unavailable",
  "unsupported_transport",
]);

// DNS-pinned, redirect-refusing fetch for URLs users typed (SSRF).
const untrustedFetch: FetchFunction = (input, init) =>
  fetchWithValidatedEndpoint({
    init,
    url: input instanceof Request ? input.url : input,
  });

const closeQuietly = async (client: MCPClient | undefined) => {
  try {
    await client?.close();
  } catch {
    // Already gone; nothing to release.
  }
};

const abortable = <T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> =>
  signal
    ? Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          signal.throwIfAborted();
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        }),
      ])
    : promise;

export const createMcpManager = (options: McpManagerOptions): McpManager => {
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const random = options.random ?? Math.random;
  const timeouts = { ...DEFAULT_TIMEOUTS, ...options.timeouts };
  const reconnect = { ...DEFAULT_RECONNECT, ...options.reconnect };
  const circuit = { ...DEFAULT_CIRCUIT, ...options.circuit };
  const idleTimeoutMs = options.idleTimeoutMs ?? IDLE_TIMEOUT_MS;
  const maxTools = options.maxTools ?? 1000;
  const entries = new Map<string, Entry>();
  const oauthDeps: OAuthDeps | undefined = options.oauth && {
    fetch: options.fetch,
    flows: options.oauth.flows ?? createMemoryFlowStore({ now }),
    now,
    settings: options.oauth.settings,
    store: options.oauth.store,
  };

  const dispose = async (entry: Entry) => {
    entry.disposed = true;
    if (entries.get(entry.key) === entry) {
      entries.delete(entry.key);
    }
    await closeQuietly(entry.live?.client);
    entry.live = undefined;
  };

  const markLost = (entry: Entry, generation: number) => {
    if (entry.generation === generation) {
      entry.lost = true;
    }
  };

  const headersFor = (
    server: McpServerConfig
  ): Result<Record<string, string>, McpError> => {
    if (server.auth.type !== "header") {
      return ok({ ...server.headers });
    }
    if (!server.auth.secret) {
      return err({
        message: "This MCP server's header secret isn't set.",
        type: "secrets_unavailable",
      });
    }
    if (!options.keys?.ok) {
      return err({
        message:
          options.keys && !options.keys.ok && "message" in options.keys.error
            ? options.keys.error.message
            : "Secrets can't be read on this instance (ENCRYPTION_KEY).",
        type: "secrets_unavailable",
      });
    }
    const value = open(
      options.keys.value,
      server.auth.secret,
      MCP_HEADER_SECRET_AAD
    );
    if (!value.ok) {
      return err({
        message:
          "This MCP server's header secret can't be read; save it again.",
        type: "secrets_unavailable",
      });
    }
    return ok({ ...server.headers, [server.auth.headerName]: value.value });
  };

  const listAllTools = async (client: MCPClient): Promise<ListToolsResult> => {
    const deadline = now() + timeouts.listToolsMs;
    const tools: ListToolsResult["tools"] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_TOOL_PAGES; page += 1) {
      // biome-ignore lint/performance/noAwaitInLoops: each page needs the previous page's cursor.
      const result = await client.listTools({
        options: { timeout: Math.max(1, deadline - now()) },
        params: cursor === undefined ? undefined : { cursor },
      });
      tools.push(...result.tools);
      cursor = result.nextCursor;
      if (cursor === undefined || tools.length >= maxTools) {
        break;
      }
    }
    return { tools: tools.slice(0, maxTools) };
  };

  /** OAuth servers: the user's tokens (refreshed if about to lapse), or why not. */
  const oauthFor = async (
    server: McpServerConfig,
    userId: UserId
  ): Promise<
    Result<ReturnType<typeof connectionAuth> | undefined, McpError>
  > => {
    if (server.auth.type !== "oauth") {
      return ok(undefined);
    }
    if (!oauthDeps) {
      return err({
        message: "OAuth for MCP servers isn't configured on this instance.",
        type: "oauth_unavailable",
      });
    }
    const stored = await oauthDeps.store.load(server.id, userId);
    if (!stored.ok) {
      return stored;
    }
    if (
      !(
        stored.value &&
        (await refreshIfExpiring(oauthDeps, server, userId, stored.value))
      )
    ) {
      return err({ type: "needs_auth" });
    }
    // Reload: a refresh just replaced what was stored.
    const current = await oauthDeps.store.load(server.id, userId);
    return current.ok && current.value
      ? ok(connectionAuth(oauthDeps, server, userId, current.value))
      : err({ type: "needs_auth" });
  };

  const fetchFor = (server: McpServerConfig): FetchFunction | undefined => {
    if (options.fetch) {
      return options.fetch;
    }
    return server.trusted || options.allowPrivateNetworks
      ? undefined
      : untrustedFetch;
  };

  const connectOnce = async (
    entry: Entry,
    server: McpServerConfig,
    userId: UserId
  ): Promise<Result<Live, McpError & { readonly rateLimited?: boolean }>> => {
    const url = checkServerUrl(server, {
      allowPrivateNetworks: options.allowPrivateNetworks,
    });
    if (!url.ok) {
      return url;
    }
    const headers = headersFor(server);
    if (!headers.ok) {
      return headers;
    }
    const auth = await oauthFor(server, userId);
    if (!auth.ok) {
      return auth;
    }
    const oauth = auth.value;

    entry.generation += 1;
    const { generation } = entry;
    let client: MCPClient | undefined;
    try {
      client = await createMCPClient({
        clientName: options.clientName,
        initializationOptions: { timeout: timeouts.initMs },
        onUncaughtError: (error) => {
          if (isConnectionLost(error)) {
            markLost(entry, generation);
          }
        },
        transport: {
          authProvider: oauth?.provider,
          fetch: fetchFor(server),
          headers: headers.value,
          onSessionExpired: () => markLost(entry, generation),
          redirect: "error",
          type: server.transport,
          url: url.value.href,
        },
      });
      const definitions = await listAllTools(client);
      return ok({ client, definitions });
    } catch (error) {
      await closeQuietly(client);
      if (oauth?.wantsSignIn()) {
        return err({ type: "needs_auth" });
      }
      return err({
        ...classifyError(error),
        rateLimited: isRateLimited(error),
      });
    }
  };

  /** One round: a fresh connection tries once; a dropped one retries with backoff. */
  const connectRound = async (
    entry: Entry,
    server: McpServerConfig,
    userId: UserId
  ): Promise<Result<Live, McpError>> => {
    await closeQuietly(entry.live?.client);
    entry.live = undefined;
    const attempts = entry.everConnected ? reconnect.attempts : 1;
    let lastError: McpError = unavailable(
      "Couldn't connect to the MCP server."
    );
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (attempt > 0) {
        // biome-ignore lint/performance/noAwaitInLoops: attempts are sequential on purpose (backoff).
        await sleep(backoffDelay(reconnect, attempt, random));
      }
      const result = await connectOnce(entry, server, userId);
      if (result.ok) {
        if (entry.disposed) {
          await closeQuietly(result.value.client);
          return err(unavailable("The connection was closed."));
        }
        entry.live = result.value;
        entry.lost = false;
        entry.everConnected = true;
        entry.circuit = closedCircuit(now());
        entry.lastError = undefined;
        return result;
      }
      const { rateLimited, ...error } = result.error;
      lastError = error;
      if (FINAL.has(error.type)) {
        entry.lastError = error;
        return err(error);
      }
      if (rateLimited) {
        // LibreChat stops reconnecting on a 429; the breaker's cap does that here.
        entry.lastError = error;
        entry.circuit = {
          ...entry.circuit,
          openUntil: now() + circuit.maxBackoffMs,
        };
        return err(error);
      }
    }
    entry.lastError = lastError;
    entry.circuit = recordFailedRound(entry.circuit, circuit, now());
    return err(lastError);
  };

  const acquire = async (
    server: McpServerConfig,
    userId: UserId
  ): Promise<Result<Live, McpError>> => {
    const key = connectionKey(server, userId);
    let entry = entries.get(key);
    if (entry && entry.version !== server.version) {
      await dispose(entry);
      entry = undefined;
    }
    if (!entry) {
      entry = {
        circuit: closedCircuit(now()),
        disposed: false,
        everConnected: false,
        generation: 0,
        key,
        lastUsed: now(),
        lost: false,
        perUser: isPerUser(server),
        version: server.version,
      };
      entries.set(key, entry);
    }
    entry.lastUsed = now();
    if (entry.live && !entry.lost) {
      return ok(entry.live);
    }
    if (entry.pending) {
      return entry.pending;
    }
    if (isCircuitOpen(entry.circuit, now())) {
      return err(
        entry.lastError ??
          unavailable("The MCP server keeps failing; retrying later.")
      );
    }
    const current = entry;
    current.pending = connectRound(current, server, userId).finally(() => {
      current.pending = undefined;
    });
    return current.pending;
  };

  const entryFor = (server: McpServerConfig, userId: UserId) =>
    entries.get(connectionKey(server, userId));

  const callTool = async (
    server: McpServerConfig,
    userId: UserId,
    name: string,
    input: unknown,
    signal: AbortSignal | undefined,
    retried = false
  ): Promise<unknown> => {
    const live = await acquire(server, userId);
    if (!live.ok) {
      throw new Error(describeError(live.error));
    }
    try {
      return await live.value.client.callTool({
        arguments: (input ?? {}) as Record<string, unknown>,
        name,
        options: { signal, timeout: timeouts.requestMs },
      });
    } catch (error) {
      if (signal?.aborted || !isConnectionLost(error)) {
        throw error;
      }
      const entry = entryFor(server, userId);
      if (entry?.live === live.value) {
        entry.lost = true;
      }
      // Safe to send again only if the server never saw it.
      if (!retried && wasNotDelivered(error)) {
        return callTool(server, userId, name, input, signal, true);
      }
      throw new Error(describeError(classifyError(error)), { cause: error });
    }
  };

  const toolsFor = (
    server: McpServerConfig,
    live: Live,
    userId: UserId,
    subset?: readonly string[]
  ): ToolSet => {
    const allowed = live.definitions.tools.filter((definition) =>
      isToolAllowed(definition.name, server.tools, subset)
    );
    const converted = live.client.toolsFromDefinitions({
      ...live.definitions,
      tools: allowed,
    });
    const tools: Record<string, Tool> = {};
    for (const definition of allowed) {
      const base = converted[definition.name];
      const name = namespacedToolName(server.name, definition.name);
      if (!base || tools[name]) {
        continue;
      }
      // The converted tool's own `execute` is bound to this client; route
      // calls through the manager so they survive a reconnect.
      tools[name] = {
        ...base,
        execute: (
          input: unknown,
          execution: ToolExecutionOptions<Record<string, unknown>>
        ) =>
          callTool(
            server,
            userId,
            definition.name,
            input,
            execution.abortSignal
          ),
      } as Tool;
    }
    return tools;
  };

  const resolveAndAcquire = async (
    id: LibraryItemId,
    userId: UserId
  ): Promise<Result<{ live: Live; server: McpServerConfig }, McpError>> => {
    const server = await options.resolveServer(id);
    if (!server.ok) {
      return server;
    }
    const live = await acquire(server.value, userId);
    return live.ok ? ok({ live: live.value, server: server.value }) : live;
  };

  const evictIdle = async (): Promise<number> => {
    const cutoff = now() - idleTimeoutMs;
    const idle = [...entries.values()].filter(
      (entry) =>
        !entry.pending &&
        entry.lastUsed < cutoff &&
        (entry.perUser || !entry.live)
    );
    await Promise.all(idle.map(dispose));
    return idle.length;
  };

  const sweepIntervalMs = options.sweepIntervalMs ?? SWEEP_INTERVAL_MS;
  const sweeper =
    sweepIntervalMs > 0
      ? setInterval(() => {
          evictIdle().catch(() => undefined);
        }, sweepIntervalMs)
      : undefined;
  // The sweep alone shouldn't keep a process (or a test run) alive.
  sweeper?.unref?.();

  const dropUserConnection = async (id: LibraryItemId, userId: UserId) => {
    const entry = entries.get(`user:${userId}:${id}`);
    if (entry) {
      await dispose(entry);
    }
  };

  return {
    close: async () => {
      if (sweeper) {
        clearInterval(sweeper);
      }
      await Promise.all([...entries.values()].map(dispose));
    },
    completeOAuth: async (input, userId) => {
      if (!oauthDeps) {
        return err({
          message: "OAuth for MCP servers isn't configured on this instance.",
          type: "oauth_unavailable",
        });
      }
      const done = await completeAuthorization(
        oauthDeps,
        options.resolveServer,
        input,
        userId
      );
      if (done.ok) {
        // The next use connects with the new tokens.
        await dropUserConnection(done.value, userId);
      }
      return done;
    },
    disconnectOAuth: async (id, userId) => {
      await options.oauth?.store.remove(id, userId);
      await dropUserConnection(id, userId);
    },
    evictIdle,
    listTools: async (id, userId) => {
      const acquired = await resolveAndAcquire(id, userId);
      if (!acquired.ok) {
        return acquired;
      }
      const { live, server } = acquired.value;
      return ok(
        live.definitions.tools
          .filter((definition) => isToolAllowed(definition.name, server.tools))
          .map((definition) => ({
            description: definition.description ?? null,
            inputSchema: JSON.parse(JSON.stringify(definition.inputSchema)),
            name: safeToolName(definition.name).slice(0, 128),
          }))
      );
    },
    openConnections: () =>
      [...entries.values()].filter((entry) => entry.live && !entry.lost).length,
    resolveServer: options.resolveServer,
    startOAuth: async (id, userId) => {
      const server = await options.resolveServer(id);
      if (!server.ok) {
        return server;
      }
      if (!oauthDeps) {
        return err({
          message: "OAuth for MCP servers isn't configured on this instance.",
          type: "oauth_unavailable",
        });
      }
      const url = checkServerUrl(server.value, {
        allowPrivateNetworks: options.allowPrivateNetworks,
      });
      if (!url.ok) {
        return url;
      }
      return beginAuthorization(oauthDeps, server.value, userId);
    },
    status: async (id, userId) => {
      const acquired = await resolveAndAcquire(id, userId);
      if (!acquired.ok) {
        return toStatus(acquired.error);
      }
      const { live, server } = acquired.value;
      return {
        state: "connected",
        toolCount: live.definitions.tools.filter((definition) =>
          isToolAllowed(definition.name, server.tools)
        ).length,
      };
    },
    toolSource: (userId) => ({
      tools: async (ref, toolOptions) => {
        try {
          const acquired = await abortable(
            resolveAndAcquire(ref.id, userId),
            toolOptions?.signal
          );
          if (!acquired.ok) {
            return err(toToolError(acquired.error));
          }
          const { live, server } = acquired.value;
          return ok(toolsFor(server, live, userId, ref.tools));
        } catch {
          return err({ message: "Cancelled.", type: "unavailable" });
        }
      },
    }),
  };
};
