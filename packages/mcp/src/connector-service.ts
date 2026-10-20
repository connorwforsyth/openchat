import type { LibraryItemId, UserId } from "@workspace/contract/schemas/common";
import type {
  Connector,
  ConnectorList,
  SetConnectorEnabledInput,
  UserServerPolicy,
} from "@workspace/contract/schemas/library";
import type { Db } from "@workspace/db/client";
import { listGrantsForPrincipals } from "@workspace/db/queries/grants";
import type { McpServerRow } from "@workspace/db/queries/library";
import { listMcpServers } from "@workspace/db/queries/library";
import {
  getMcpServer,
  listConnectorPrefs,
  setConnectorPref,
} from "@workspace/db/queries/mcp";
import { loadPrincipals } from "@workspace/db/queries/teams";
import { type AsyncResult, err, ok } from "@workspace/shared/result";
import { z } from "zod";

import {
  disabledServerIds,
  effectiveConnectors,
  enabledServerIds,
  type LibraryConnector,
  toggleConnector,
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
  readonly userServers: UserServerPolicy;
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

export const loadConnectors = async (
  deps: ConnectorDeps,
  userId: UserId
): Promise<readonly Connector[]> => {
  if (!deps.db) {
    return effectiveConnectors({
      catalog: deps.catalog,
      library: [],
      prefs: new Map(),
    });
  }
  const [library, prefs] = await Promise.all([
    loadLibrary(deps.db, userId),
    listConnectorPrefs(deps.db, userId),
  ]);
  return effectiveConnectors({
    catalog: deps.catalog,
    library: library.map(toLibraryConnector),
    prefs,
  });
};

/** For plain chats: every server the user has on and this server can run. */
export const enabledServersFor = async (
  deps: ConnectorDeps,
  userId: UserId
): Promise<readonly LibraryItemId[]> =>
  enabledServerIds(await loadConnectors(deps, userId));

/** For every run: the servers the user (or the operator) turned off. */
export const disabledServersFor = async (
  deps: ConnectorDeps,
  userId: UserId
): Promise<ReadonlySet<LibraryItemId>> =>
  disabledServerIds(await loadConnectors(deps, userId));

export const connectorHandlers = {
  /** GET /connectors. */
  list: async (
    deps: ConnectorDeps,
    session: { readonly userId: UserId }
  ): Promise<ConnectorList> => ({
    connectors: [...(await loadConnectors(deps, session.userId))],
    userServers: deps.userServers,
  }),

  /** PUT /connectors/{id}/enabled. */
  setEnabled: async (
    deps: ConnectorDeps,
    session: { readonly userId: UserId },
    input: SetConnectorEnabledInput
  ): AsyncResult<Connector, McpHandlerError> => {
    const connectors = await loadConnectors(deps, session.userId);
    const connector = connectors.find((item) => item.id === input.id);
    if (!connector) {
      return err({ code: "NOT_FOUND" });
    }
    const toggled = toggleConnector(connector, input.enabled);
    if (!toggled.ok) {
      return err({ code: "FORBIDDEN" });
    }
    if (!deps.db) {
      return err({
        code: "VALIDATION",
        data: {
          issues: [
            { message: "Saving choices needs a database.", path: ["id"] },
          ],
        },
      });
    }
    await setConnectorPref(deps.db, {
      enabled: input.enabled,
      mcpServerId: input.id,
      userId: session.userId,
    });
    return ok(toggled.value);
  },
};
