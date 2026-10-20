import type { AppConfig } from "@workspace/config/schema";
import type { LibraryItemId } from "@workspace/contract/schemas/common";
import type { Db } from "@workspace/db/client";
import { getMcpServer } from "@workspace/db/queries/mcp";
import { type AsyncResult, err, ok } from "@workspace/shared/result";

import type { McpError } from "./errors";
import {
  fromInstanceConfig,
  fromLibraryRow,
  type InstanceServerEntry,
  isRemoteEntry,
  type McpServerConfig,
  missingSecrets,
} from "./server-config";

// Where server definitions come from (LibreChat's MCPServersRegistry,
// without its caches: instance servers are parsed once at boot, library
// servers are one indexed read). No database means instance servers only,
// so an empty `.env` still boots.

export interface ServerRegistry {
  /** The operator's whole catalog, stdio and unconfigured entries included (184). */
  readonly catalog: readonly InstanceServerEntry[];
  /**
   * Instance servers this process can connect to: remote entries whose
   * `${ENV}` secrets are all set. Who has which on is `effectiveMcpServers`.
   */
  readonly instanceServers: readonly McpServerConfig[];
  readonly resolve: (
    id: LibraryItemId
  ) => AsyncResult<McpServerConfig, McpError>;
}

export const createServerRegistry = (options: {
  readonly config: AppConfig["mcp"];
  readonly db?: Db;
}): ServerRegistry => {
  const catalog = options.config.servers;
  const instanceServers = catalog
    .filter(isRemoteEntry)
    .filter((entry) => missingSecrets(entry).length === 0)
    .map(fromInstanceConfig);
  const byId = new Map(instanceServers.map((server) => [server.id, server]));
  return {
    catalog,
    instanceServers,
    resolve: async (id) => {
      const instance = byId.get(id);
      if (instance) {
        return ok(instance);
      }
      if (!options.db) {
        return err({ serverId: id, type: "not_found" });
      }
      const row = await getMcpServer(options.db, id);
      return row.ok
        ? fromLibraryRow(row.value)
        : err({ serverId: id, type: "not_found" });
    },
  };
};
