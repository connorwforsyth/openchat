import type { AppConfig } from "@workspace/config/schema";
import type { LibraryItemId } from "@workspace/contract/schemas/common";
import type { Db } from "@workspace/db/client";
import { getMcpServer } from "@workspace/db/queries/mcp";
import { type AsyncResult, err, ok } from "@workspace/shared/result";

import type { McpError } from "./errors";
import {
  fromInstanceConfig,
  fromLibraryRow,
  type McpServerConfig,
} from "./server-config";

// Where server definitions come from (LibreChat's MCPServersRegistry,
// without its caches: instance servers are parsed once at boot, library
// servers are one indexed read). No database means instance servers only,
// so an empty `.env` still boots.

export interface ServerRegistry {
  /** Instance servers from app.config.yaml, available to everyone. */
  readonly instanceServers: readonly McpServerConfig[];
  readonly resolve: (
    id: LibraryItemId
  ) => AsyncResult<McpServerConfig, McpError>;
}

export const createServerRegistry = (options: {
  readonly config: AppConfig["mcp"];
  readonly db?: Db;
}): ServerRegistry => {
  const instanceServers = options.config.servers.map(fromInstanceConfig);
  const byId = new Map(instanceServers.map((server) => [server.id, server]));
  return {
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
