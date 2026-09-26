import {
  type LibraryItemId,
  userIdSchema,
} from "@workspace/contract/schemas/common";
import type {
  McpConnectionStatus,
  McpTool,
} from "@workspace/contract/schemas/library";
import { principalSchema } from "@workspace/contract/schemas/tenancy";
import type { Db } from "@workspace/db/client";
import { listGrantsForPrincipals } from "@workspace/db/queries/grants";
import { getMcpServer } from "@workspace/db/queries/mcp";
import { loadPrincipals } from "@workspace/db/queries/teams";
import { type AsyncResult, err, ok } from "@workspace/shared/result";
import { z } from "zod";

import { describeError, type McpError } from "./errors";
import type { McpManager } from "./manager";
import { type CallbackInput, callbackInputSchema } from "./oauth";
import type { McpServerConfig } from "./server-config";

// The contract's `mcp` procedure group as plain functions over
// `{ db, session, manager }`; ticket 025 mounts them on oRPC and turns the
// error codes into the contract's typed errors. Input has already passed
// the contract's zod schemas by the time it gets here.

export const mcpSessionSchema = z.object({ userId: userIdSchema });
export type McpSession = z.infer<typeof mcpSessionSchema>;

export interface McpHandlerDeps {
  /** `undefined` without DATABASE_URL: only instance servers exist then. */
  readonly db?: Db;
  readonly manager: McpManager;
  readonly session: McpSession;
}

/** The contract's base error codes these handlers use, with oRPC's `data`. */
export type McpHandlerError =
  | { readonly code: "FORBIDDEN" | "NOT_FOUND" }
  | {
      readonly code: "VALIDATION";
      readonly data: {
        readonly issues: readonly {
          readonly message: string;
          readonly path: readonly (number | string)[];
        }[];
      };
    };

const validation = (message: string): McpHandlerError => ({
  code: "VALIDATION",
  data: { issues: [{ message, path: ["id"] }] },
});

/**
 * Whether the caller may `use` the server: instance servers are everyone's;
 * a library server needs ownership (as the user or through a team or org
 * they're in) or a grant. Any grant level includes `use` (D13). Ticket 012's
 * `effectiveGrants` can replace this once it lands.
 */
export const canUseServer = async (
  db: Db | undefined,
  userId: McpSession["userId"],
  server: Pick<McpServerConfig, "id" | "owner">
): Promise<boolean> => {
  if (server.owner === null) {
    return true;
  }
  if (!db) {
    return false;
  }
  const principals = await loadPrincipals(db, userId);
  const { owner } = server;
  if (principals.some((p) => p.type === owner.type && p.id === owner.id)) {
    return true;
  }
  const grants = await listGrantsForPrincipals(db, principals, {
    resourceIds: [server.id],
    resourceType: "mcp_server",
  });
  return grants.length > 0;
};

/**
 * Resolves the server and checks access; unknown and forbidden look alike.
 * A saved server this surface can't run (stdio, a broken definition) is
 * still checked against its owner, and then reported as that error.
 */
const authorize = async (
  deps: McpHandlerDeps,
  id: LibraryItemId
): AsyncResult<McpServerConfig, McpHandlerError | McpError> => {
  const server = await deps.manager.resolveServer(id);
  if (server.ok) {
    return (await canUseServer(deps.db, deps.session.userId, server.value))
      ? server
      : err({ code: "NOT_FOUND" });
  }
  if (server.error.type === "not_found" || !deps.db) {
    return err({ code: "NOT_FOUND" });
  }
  const row = await getMcpServer(deps.db, id);
  const owner = row.ok
    ? principalSchema.safeParse({
        id: row.value.ownerId,
        type: row.value.ownerType,
      })
    : undefined;
  return owner?.success &&
    (await canUseServer(deps.db, deps.session.userId, {
      id,
      owner: owner.data,
    }))
    ? server
    : err({ code: "NOT_FOUND" });
};

const isHandlerError = (
  error: McpHandlerError | McpError
): error is McpHandlerError => "code" in error;

export const mcpHandlers = {
  /** DELETE /mcp/{id}/oauth: forget the caller's tokens. */
  disconnect: async (
    deps: McpHandlerDeps,
    input: { readonly id: LibraryItemId }
  ): AsyncResult<void, McpHandlerError> => {
    const server = await authorize(deps, input.id);
    if (!server.ok && isHandlerError(server.error)) {
      return err(server.error);
    }
    await deps.manager.disconnectOAuth(input.id, deps.session.userId);
    return ok(undefined);
  },

  /** POST /mcp/{id}/oauth: where to send the caller to sign in. */
  startOAuth: async (
    deps: McpHandlerDeps,
    input: { readonly id: LibraryItemId }
  ): AsyncResult<{ readonly authorizationUrl: string }, McpHandlerError> => {
    const server = await authorize(deps, input.id);
    if (!server.ok) {
      return err(
        isHandlerError(server.error)
          ? server.error
          : validation(describeError(server.error))
      );
    }
    const url = await deps.manager.startOAuth(input.id, deps.session.userId);
    return url.ok
      ? ok({ authorizationUrl: url.value.href })
      : err(validation(describeError(url.error)));
  },

  /** GET /mcp/{id}/status: connects if needed; failures are a status, not an error. */
  status: async (
    deps: McpHandlerDeps,
    input: { readonly id: LibraryItemId }
  ): AsyncResult<McpConnectionStatus, McpHandlerError> => {
    const server = await authorize(deps, input.id);
    if (!server.ok && isHandlerError(server.error)) {
      return err(server.error);
    }
    return ok(await deps.manager.status(input.id, deps.session.userId));
  },

  /** GET /mcp/{id}/tools: empty when the server can't be reached (see `status`). */
  tools: async (
    deps: McpHandlerDeps,
    input: { readonly id: LibraryItemId }
  ): AsyncResult<readonly McpTool[], McpHandlerError> => {
    const server = await authorize(deps, input.id);
    if (!server.ok && isHandlerError(server.error)) {
      return err(server.error);
    }
    const tools = await deps.manager.listTools(input.id, deps.session.userId);
    return ok(tools.ok ? tools.value : []);
  },
};

export type McpCallbackResult =
  | { readonly ok: true; readonly serverId: LibraryItemId }
  | { readonly message: string; readonly ok: false };

/**
 * The OAuth callback route (`GET …/mcp/oauth/callback?code&state`), outside
 * the contract. The route authenticates the session and renders the result
 * (a page that closes itself, say); this does the rest.
 */
export const handleOAuthCallback = async (
  deps: Pick<McpHandlerDeps, "manager" | "session">,
  query: URLSearchParams
): Promise<McpCallbackResult> => {
  const error = query.get("error");
  if (error !== null) {
    return {
      message: "The sign-in was cancelled or refused.",
      ok: false,
    };
  }
  const input = callbackInputSchema.safeParse({
    code: query.get("code") ?? undefined,
    iss: query.get("iss") ?? undefined,
    state: query.get("state") ?? undefined,
  });
  if (!input.success) {
    return { message: "The sign-in response is incomplete.", ok: false };
  }
  const done = await deps.manager.completeOAuth(
    input.data satisfies CallbackInput,
    deps.session.userId
  );
  return done.ok
    ? { ok: true, serverId: done.value }
    : { message: describeError(done.error), ok: false };
};
