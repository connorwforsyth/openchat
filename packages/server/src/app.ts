import { SmartCoercionPlugin } from "@orpc/json-schema";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import type { AnyRouter } from "@orpc/server";
import { BatchHandlerPlugin } from "@orpc/server/plugins";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { generateOpenApi } from "@workspace/contract/openapi";
import { runIdSchema } from "@workspace/contract/schemas/common";
import { getRun } from "@workspace/db/queries/runs";
import { Hono } from "hono";

import { type ApiServices, createChatRouter } from "./api/router";
import {
  actorFor,
  type RequestContext,
  type Session,
  type SessionResolver,
} from "./context";
import { problem } from "./http/problem";
import { runStreamResponse } from "./stream/sse";

// The HTTP app (D26): Hono as a thin adapter over the oRPC contract, served
// under `/api`. 025 mounts it in `apps/web` (`app/api/[[...route]]/route.ts`,
// `runtime = "nodejs"`, `dynamic = "force-dynamic"`, docs/decisions/0004).
//
// It boots with an empty environment: with no database the chat routes
// answer 503 and say why, and any extra routers (auth, meta) still work.

export interface CreateAppOptions {
  /**
   * More per-request context for routers that need it beside the session
   * (the auth handlers' `HandlerContext`). Merged over `{ request, session }`.
   */
  readonly context?: (
    request: Request,
    session: Session | null
  ) => Promise<Readonly<Record<string, unknown>>>;
  /** Reads the caller from the request (ticket 012's session lookup). */
  readonly resolveSession: SessionResolver;
  /** Extra procedure groups beside the chat ones (auth, library, …), keyed like the contract. */
  readonly routers?: Readonly<Record<string, AnyRouter>>;
  /**
   * Plain HTTP routes that aren't procedures (the auth handler, downloads,
   * OAuth callbacks), registered before the procedures.
   */
  readonly routes?: (app: Hono) => void;
  /** `null` when there is no database. */
  readonly services: ApiServices | null;
}

/** Procedure groups that need the database, for the "no database" answer. */
const DATABASE_PATHS = [
  /^\/api\/(artifacts|budgets|conversations|decisions|files|grants|invitations|keys|library|llm|mcp|me|memory|messages|models|orgs|runs|sandboxes|search|share|share-links|teams|usage)(\/|$)/,
];

const noDatabase = () =>
  problem(
    503,
    "SERVICE_UNAVAILABLE",
    "Chat needs a database. Set DATABASE_URL and restart (see .env.example)."
  );

export const createApp = ({
  context: extraContext,
  resolveSession,
  routers = {},
  routes,
  services,
}: CreateAppOptions) => {
  const router = {
    ...(services ? createChatRouter(services) : {}),
    ...routers,
  };
  const handler = new OpenAPIHandler<RequestContext>(router, {
    // GET inputs arrive as strings; coerce them by the contract's schemas
    // (contract README "Conventions").
    plugins: [
      new SmartCoercionPlugin({
        schemaConverters: [new ZodToJsonSchemaConverter()],
      }),
      // The client batches concurrent GETs (feedback per message, Q38) into
      // one request; each still runs as its own procedure with this context.
      new BatchHandlerPlugin({ maxSize: 10 }),
    ],
  });

  const app = new Hono();

  app.onError((_cause, c) =>
    c.json(
      {
        code: "INTERNAL_SERVER_ERROR",
        defined: false,
        message: "Something went wrong.",
        status: 500,
      },
      500
    )
  );

  routes?.(app);

  // The API's own description (D26, PLAN.md §11 "Contract"), public like the
  // docs it feeds. Built from the contract this server implements, once, on
  // first request; `packages/contract/openapi.json` is the same document.
  let openApi: ReturnType<typeof generateOpenApi> | undefined;
  app.get("/api/openapi.json", async (c) => {
    openApi ??= generateOpenApi();
    return c.json(await openApi);
  });

  // The run stream isn't a procedure: SSE in the AI SDK's UI message stream
  // protocol (contract README "The run stream").
  app.get("/api/runs/:id/stream", async (c) => {
    if (!services) {
      return noDatabase();
    }
    const session = await resolveSession(c.req.raw);
    if (!session) {
      return problem(401, "UNAUTHORIZED", "Sign in to continue.");
    }
    const runId = runIdSchema.safeParse(c.req.param("id"));
    const run = runId.success ? await getRun(services.db, runId.data) : null;
    if (!run?.ok) {
      return problem(404, "NOT_FOUND", "Not found.");
    }
    const actor = await actorFor(services.db, session);
    if (!(await services.access(actor, run.value.conversationId, "read"))) {
      return problem(404, "NOT_FOUND", "Not found.");
    }
    return runStreamResponse(services.streams, run.value.id, c.req.raw);
  });

  app.all("/api/*", async (c) => {
    const request = c.req.raw;
    const session = await resolveSession(request);
    const { matched, response } = await handler.handle(request, {
      context: {
        ...(extraContext ? await extraContext(request, session) : {}),
        request,
        session,
      },
      prefix: "/api",
    });
    if (matched) {
      return response;
    }
    const { pathname } = new URL(request.url);
    if (!services && DATABASE_PATHS.some((path) => path.test(pathname))) {
      return noDatabase();
    }
    return problem(404, "NOT_FOUND", "Not found.");
  });

  return app;
};

export type App = ReturnType<typeof createApp>;
