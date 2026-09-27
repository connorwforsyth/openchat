import { implement, ORPCError } from "@orpc/server";
import { contract } from "@workspace/contract/contract";
import type { Db } from "@workspace/db/client";
import { type McpHandlerError, mcpHandlers } from "@workspace/mcp/handlers";
import type { McpManager } from "@workspace/mcp/manager";
import type { Result } from "@workspace/shared/result";

import type { RequestContext } from "../context";
import { forbiddenError, notFoundError, validationError } from "./errors";

// The `mcp` group (018) over its plain-function handlers: connection status,
// tool discovery and the per-user OAuth start and disconnect. The OAuth
// callback is plain HTTP (`app.ts`), since a browser lands on it.

const toOrpcError = (error: McpHandlerError): ORPCError<string, unknown> => {
  switch (error.code) {
    case "NOT_FOUND":
      return notFoundError();
    case "FORBIDDEN":
      return forbiddenError();
    case "VALIDATION":
      return validationError(error.data.issues);
    default:
      return error satisfies never;
  }
};

const unwrap = <T>(result: Result<T, McpHandlerError>): T => {
  if (!result.ok) {
    throw toOrpcError(result.error);
  }
  return result.value;
};

export interface McpRouterDeps {
  readonly db: Db;
  readonly manager: McpManager;
}

export const createMcpRouter = ({ db, manager }: McpRouterDeps) => {
  const os = implement({ mcp: contract.mcp }).$context<RequestContext>();
  const authed = os.use(({ context, next }) => {
    if (!context.session) {
      throw new ORPCError("UNAUTHORIZED");
    }
    return next({
      context: { handler: { db, manager, session: context.session } },
    });
  });

  return os.router({
    mcp: {
      disconnect: authed.mcp.disconnect.handler(async ({ context, input }) => {
        unwrap(await mcpHandlers.disconnect(context.handler, input));
      }),
      startOAuth: authed.mcp.startOAuth.handler(async ({ context, input }) =>
        unwrap(await mcpHandlers.startOAuth(context.handler, input))
      ),
      status: authed.mcp.status.handler(async ({ context, input }) =>
        unwrap(await mcpHandlers.status(context.handler, input))
      ),
      tools: authed.mcp.tools.handler(async ({ context, input }) => [
        ...unwrap(await mcpHandlers.tools(context.handler, input)),
      ]),
    },
  });
};
