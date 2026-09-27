import { SmartCoercionPlugin } from "@orpc/json-schema";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import type { AnyRouter } from "@orpc/server";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { runIdSchema } from "@workspace/contract/schemas/common";
import { getRun } from "@workspace/db/queries/runs";
import { Hono } from "hono";

import { type ApiServices, createChatRouter } from "./api/router";
import { actorFor, type RequestContext, type SessionResolver } from "./context";
import { runStreamResponse } from "./stream/sse";

// The HTTP app (D26): Hono as a thin adapter over the oRPC contract, served
// under `/api`. 025 mounts it in `apps/web` (`app/api/[[...route]]/route.ts`,
// `runtime = "nodejs"`, `dynamic = "force-dynamic"`, docs/decisions/0004).
//
// It boots with an empty environment: with no database the chat routes
// answer 503 and say why, and any extra routers (auth, meta) still work.

export interface CreateAppOptions {
  /** Reads the caller from the request (ticket 012's session lookup). */
  readonly resolveSession: SessionResolver;
  /** Extra procedure groups beside the chat ones (auth, library, …), keyed like the contract. */
  readonly routers?: Readonly<Record<string, AnyRouter>>;
  /** `null` when there is no database. */
  readonly services: ApiServices | null;
}

/** The procedure groups this package serves; they need the database. */
const CHAT_PATHS = [
  /^\/api\/conversations(\/|$)/,
  /^\/api\/memory(\/|$)/,
  /^\/api\/messages\//,
  /^\/api\/runs(\/|$)/,
];

const problem = (status: number, code: string, message: string) =>
  Response.json({ code, defined: false, message, status }, { status });

const noDatabase = () =>
  problem(
    503,
    "SERVICE_UNAVAILABLE",
    "Chat needs a database. Set DATABASE_URL and restart (see .env.example)."
  );

export const createApp = ({
  resolveSession,
  routers = {},
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
    const { matched, response } = await handler.handle(request, {
      context: { request, session: await resolveSession(request) },
      prefix: "/api",
    });
    if (matched) {
      return response;
    }
    const { pathname } = new URL(request.url);
    if (!services && CHAT_PATHS.some((path) => path.test(pathname))) {
      return noDatabase();
    }
    return problem(404, "NOT_FOUND", "Not found.");
  });

  return app;
};

export type App = ReturnType<typeof createApp>;
