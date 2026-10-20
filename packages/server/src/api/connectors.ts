import { implement, ORPCError } from "@orpc/server";
import { contract } from "@workspace/contract/contract";
import {
  type ConnectorDeps,
  connectorHandlers,
} from "@workspace/mcp/connector-service";

import type { RequestContext } from "../context";
import { forbiddenError, notFoundError, validationError } from "./errors";

// The `connectors` group (184): the caller's merged view of the operator's
// MCP catalog and their library, and the switch for each.

export const createConnectorsRouter = (deps: ConnectorDeps) => {
  const os = implement({
    connectors: contract.connectors,
  }).$context<RequestContext>();
  const authed = os.use(({ context, next }) => {
    if (!context.session) {
      throw new ORPCError("UNAUTHORIZED");
    }
    return next({ context: { userId: context.session.userId } });
  });

  return os.router({
    connectors: {
      list: authed.connectors.list.handler(({ context }) =>
        connectorHandlers.list(deps, context)
      ),
      setEnabled: authed.connectors.setEnabled.handler(
        async ({ context, input }) => {
          const result = await connectorHandlers.setEnabled(
            deps,
            context,
            input
          );
          if (result.ok) {
            return result.value;
          }
          switch (result.error.code) {
            case "NOT_FOUND":
              throw notFoundError();
            case "FORBIDDEN":
              throw forbiddenError();
            case "VALIDATION":
              throw validationError(result.error.data.issues);
            default:
              return result.error satisfies never;
          }
        }
      ),
    },
  });
};
