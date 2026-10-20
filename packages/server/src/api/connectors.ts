import { implement, ORPCError } from "@orpc/server";
import { contract } from "@workspace/contract/contract";
import type { McpHandlerError } from "@workspace/mcp/handlers";
import { connectorHandlers, type McpDeps } from "@workspace/mcp/service";
import type { Result } from "@workspace/shared/result";

import type { RequestContext } from "../context";
import { forbiddenError, notFoundError, validationError } from "./errors";

// The `connectors` group (184): the caller's merged view of the operator's
// MCP catalog and their library, and the switch for each; and (188) each
// connector's tools, and a chat's own choices over the defaults.

export const createConnectorsRouter = (deps: McpDeps) => {
  const os = implement({
    connectors: contract.connectors,
  }).$context<RequestContext>();
  const authed = os.use(({ context, next }) => {
    if (!context.session) {
      throw new ORPCError("UNAUTHORIZED");
    }
    return next({ context: { userId: context.session.userId } });
  });

  const settle = <T>(result: Result<T, McpHandlerError>): T => {
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
  };

  return os.router({
    connectors: {
      list: authed.connectors.list.handler(({ context, input }) =>
        connectorHandlers.list(deps, context, input)
      ),
      resetConversation: authed.connectors.resetConversation.handler(
        async ({ context, input }) =>
          settle(
            await connectorHandlers.resetConversation(deps, context, input)
          )
      ),
      setEnabled: authed.connectors.setEnabled.handler(
        async ({ context, input }) =>
          settle(await connectorHandlers.setEnabled(deps, context, input))
      ),
      setToolEnabled: authed.connectors.setToolEnabled.handler(
        async ({ context, input }) =>
          settle(await connectorHandlers.setToolEnabled(deps, context, input))
      ),
      tools: authed.connectors.tools.handler(async ({ context, input }) =>
        settle(await connectorHandlers.tools(deps, context, input))
      ),
    },
  });
};
