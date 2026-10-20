import type {
  ConversationId,
  LibraryItemId,
  UserId,
} from "@workspace/contract/schemas/common";
import type {
  Connector,
  ConnectorList,
  ConnectorTool,
  ConnectorToolList,
  ListConnectorsInput,
  ListConnectorToolsInput,
  McpTool,
  ResetConversationConnectorsInput,
  SetConnectorEnabledInput,
  SetConnectorToolEnabledInput,
  UserServerPolicy,
} from "@workspace/contract/schemas/library";
import type { Db } from "@workspace/db/client";
import { getConversation } from "@workspace/db/queries/conversations";
import { listGrantsForPrincipals } from "@workspace/db/queries/grants";
import type { McpServerRow } from "@workspace/db/queries/library";
import { listMcpServers } from "@workspace/db/queries/library";
import {
  getMcpServer,
  listConnectorPrefs,
  listConversationConnectors,
  resetConversationConnectors,
  setConnectorPref,
  setConnectorToolPref,
  setConversationConnector,
  setConversationConnectorTool,
} from "@workspace/db/queries/mcp";
import { loadPrincipals } from "@workspace/db/queries/teams";
import { type AsyncResult, err, ok } from "@workspace/shared/result";
import { z } from "zod";

import {
  anyCustomized,
  type ConnectorChoices,
  connectorTools,
  disabledServerIds,
  effectiveConnectors,
  enabledServerIds,
  excludedTools,
  type LibraryConnector,
  toggleConnector,
  toggleConnectorTool,
} from "./connectors";
import type { McpHandlerError } from "./handlers";
import type { InstanceServerEntry } from "./server-config";

// The shell around `effectiveConnectors` (184): loads the user's library
// servers and stored choices, merges them with the operator's catalog, and
// serves the contract's `connectors` group and the runs' server lists.

export interface ConnectorDeps {
  readonly catalog: readonly InstanceServerEntry[];
  /** `undefined` without DATABASE_URL: the catalog alone, at its defaults. */
  readonly db?: Db;
  /**
   * A server's tools as the user's connection lists them, less what the
   * operator denies (`McpManager.listTools`, cached per connection). Left
   * out, every connector lists as unreachable.
   */
  readonly listTools?: (
    id: LibraryItemId,
    userId: UserId
  ) => AsyncResult<readonly McpTool[], unknown>;
  readonly userServers: UserServerPolicy;
}

/** Whose choices, and for which chat: `conversationId` absent is the defaults. */
interface Scope {
  readonly conversationId?: ConversationId | undefined;
  readonly userId: UserId;
}

const storedAuthSchema = z
  .object({
    auth: z
      .object({ type: z.enum(["none", "header", "oauth"]) })
      .catch({ type: "none" }),
    transport: z.string().catch("unknown"),
  })
  .catch({ auth: { type: "none" }, transport: "unknown" });

const toLibraryConnector = (row: McpServerRow): LibraryConnector => {
  const definition = storedAuthSchema.parse(row.definition);
  return {
    auth: definition.auth.type,
    description: row.description,
    id: row.id,
    name: row.name,
    transport: definition.transport,
  };
};

/** Servers the user owns (directly or through a team or org) or was shared. */
const loadLibrary = async (
  db: Db,
  userId: UserId
): Promise<readonly McpServerRow[]> => {
  const principals = await loadPrincipals(db, userId);
  const [owned, granted] = await Promise.all([
    Promise.all(principals.map((principal) => listMcpServers(db, principal))),
    listGrantsForPrincipals(db, principals, { resourceType: "mcp_server" }),
  ]);
  const rows = new Map(owned.flat().map((row) => [row.id, row]));
  const missing = [
    ...new Set(granted.map((grant) => grant.resourceId as LibraryItemId)),
  ].filter((id) => !rows.has(id));
  for (const result of await Promise.all(
    missing.map((id) => getMcpServer(db, id))
  )) {
    if (result.ok) {
      rows.set(result.value.id, result.value);
    }
  }
  return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
};

const NONE: ConnectorChoices = new Map();

export const loadConnectors = async (
  deps: ConnectorDeps,
  scope: Scope
): Promise<readonly Connector[]> => {
  if (!deps.db) {
    return effectiveConnectors({
      catalog: deps.catalog,
      library: [],
      prefs: NONE,
    });
  }
  const { conversationId, userId } = scope;
  const [library, prefs, chat] = await Promise.all([
    loadLibrary(deps.db, userId),
    listConnectorPrefs(deps.db, userId),
    conversationId
      ? listConversationConnectors(deps.db, { conversationId, userId })
      : NONE,
  ]);
  return effectiveConnectors({
    catalog: deps.catalog,
    chat,
    library: library.map(toLibraryConnector),
    prefs,
  });
};

/** What a run may use (184, 188), for its user in its chat. */
export interface McpSelection {
  /** Every server the user (or the operator) turned off: agent runs too. */
  readonly disabled: ReadonlySet<LibraryItemId>;
  /** For plain chats: every server on and runnable here. */
  readonly enabled: readonly LibraryItemId[];
  /** Tools switched off, by server; left out of every run. */
  readonly excludedTools: ReadonlyMap<LibraryItemId, readonly string[]>;
}

export const mcpSelectionFor = async (
  deps: ConnectorDeps,
  scope: Scope
): Promise<McpSelection> => {
  const connectors = await loadConnectors(deps, scope);
  return {
    disabled: disabledServerIds(connectors),
    enabled: enabledServerIds(connectors),
    excludedTools: excludedTools(connectors),
  };
};

/** For plain chats: every server the user has on and this server can run. */
export const enabledServersFor = async (
  deps: ConnectorDeps,
  userId: UserId
): Promise<readonly LibraryItemId[]> =>
  enabledServerIds(await loadConnectors(deps, { userId }));

/** For every run: the servers the user (or the operator) turned off. */
export const disabledServersFor = async (
  deps: ConnectorDeps,
  userId: UserId
): Promise<ReadonlySet<LibraryItemId>> =>
  disabledServerIds(await loadConnectors(deps, { userId }));

const needsDb = (): McpHandlerError => ({
  code: "VALIDATION",
  data: {
    issues: [{ message: "Saving choices needs a database.", path: ["id"] }],
  },
});

/**
 * Whether the caller can see the chat they're choosing for: a chat they
 * can't read is NOT_FOUND, so ids don't leak.
 */
const canSeeChat = async (
  db: Db,
  userId: UserId,
  conversationId: ConversationId
): Promise<boolean> => {
  const principals = await loadPrincipals(db, userId);
  return (await getConversation(db, conversationId, { principals, userId })).ok;
};

/** The caller's connector in this scope, or why it can't be changed. */
const findConnector = async (
  deps: ConnectorDeps,
  scope: Scope,
  id: LibraryItemId
): AsyncResult<{ connector: Connector; db: Db }, McpHandlerError> => {
  const { db } = deps;
  if (
    db &&
    scope.conversationId &&
    !(await canSeeChat(db, scope.userId, scope.conversationId))
  ) {
    return err({ code: "NOT_FOUND" });
  }
  const connector = (await loadConnectors(deps, scope)).find(
    (item) => item.id === id
  );
  if (!connector) {
    return err({ code: "NOT_FOUND" });
  }
  return db ? ok({ connector, db }) : err(needsDb());
};

const scopeOf = (
  session: { readonly userId: UserId },
  input: { readonly conversationId?: ConversationId | undefined }
): Scope => ({ conversationId: input.conversationId, userId: session.userId });

export const connectorHandlers = {
  /** GET /connectors, for the defaults or one chat. */
  list: async (
    deps: ConnectorDeps,
    session: { readonly userId: UserId },
    input: ListConnectorsInput = {}
  ): Promise<ConnectorList> => {
    const connectors = await loadConnectors(deps, scopeOf(session, input));
    return {
      connectors: [...connectors],
      customized: anyCustomized(connectors),
      userServers: deps.userServers,
    };
  },

  /** DELETE /conversations/{conversationId}/connectors. */
  resetConversation: async (
    deps: ConnectorDeps,
    session: { readonly userId: UserId },
    input: ResetConversationConnectorsInput
  ): AsyncResult<void, McpHandlerError> => {
    if (!deps.db) {
      return ok(undefined);
    }
    if (!(await canSeeChat(deps.db, session.userId, input.conversationId))) {
      return err({ code: "NOT_FOUND" });
    }
    await resetConversationConnectors(deps.db, {
      conversationId: input.conversationId,
      userId: session.userId,
    });
    return ok(undefined);
  },

  /** PUT /connectors/{id}/enabled, for the defaults or one chat. */
  setEnabled: async (
    deps: ConnectorDeps,
    session: { readonly userId: UserId },
    input: SetConnectorEnabledInput
  ): AsyncResult<Connector, McpHandlerError> => {
    const scope = scopeOf(session, input);
    const found = await findConnector(deps, scope, input.id);
    if (!found.ok) {
      return found;
    }
    const toggled = toggleConnector(found.value.connector, input.enabled);
    if (!toggled.ok) {
      return err({ code: "FORBIDDEN" });
    }
    const { db } = found.value;
    const base = { enabled: input.enabled, mcpServerId: input.id };
    await (input.conversationId
      ? setConversationConnector(db, {
          ...base,
          conversationId: input.conversationId,
          userId: session.userId,
        })
      : setConnectorPref(db, { ...base, userId: session.userId }));
    return ok(
      (await loadConnectors(deps, scope)).find(
        (item) => item.id === input.id
      ) ?? toggled.value
    );
  },

  /** PUT /connectors/{id}/tools/{tool}/enabled, for the defaults or one chat. */
  setToolEnabled: async (
    deps: ConnectorDeps,
    session: { readonly userId: UserId },
    input: SetConnectorToolEnabledInput
  ): AsyncResult<ConnectorTool, McpHandlerError> => {
    const found = await findConnector(deps, scopeOf(session, input), input.id);
    if (!found.ok) {
      return found;
    }
    const toggled = toggleConnectorTool(
      found.value.connector,
      input.tool,
      input.enabled
    );
    if (!toggled.ok) {
      return err({ code: "FORBIDDEN" });
    }
    const { db } = found.value;
    const change = {
      enabled: input.enabled,
      mcpServerId: input.id,
      tool: input.tool,
      userId: session.userId,
    };
    await (input.conversationId
      ? setConversationConnectorTool(db, {
          ...change,
          conversationId: input.conversationId,
        })
      : setConnectorToolPref(db, change));
    return ok({
      description: null,
      enabled: input.enabled,
      lock: null,
      name: input.tool,
    });
  },

  /** GET /connectors/{id}/tools, for the defaults or one chat. */
  tools: async (
    deps: ConnectorDeps,
    session: { readonly userId: UserId },
    input: ListConnectorToolsInput
  ): AsyncResult<ConnectorToolList, McpHandlerError> => {
    const scope = scopeOf(session, input);
    if (
      deps.db &&
      input.conversationId &&
      !(await canSeeChat(deps.db, session.userId, input.conversationId))
    ) {
      return err({ code: "NOT_FOUND" });
    }
    const connector = (await loadConnectors(deps, scope)).find(
      (item) => item.id === input.id
    );
    if (!connector) {
      return err({ code: "NOT_FOUND" });
    }
    const listed =
      connector.availability.state === "available"
        ? await deps.listTools?.(input.id, session.userId).catch(() => null)
        : null;
    return ok(
      listed?.ok
        ? {
            reachable: true,
            tools: [...connectorTools(connector, listed.value)],
          }
        : { reachable: false, tools: [] }
    );
  },
};
