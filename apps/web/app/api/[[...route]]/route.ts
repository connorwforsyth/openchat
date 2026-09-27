import { getServer } from "../_lib/server";

// Every `/api/*` request goes to the one Hono app (D26): the oRPC procedures,
// the run stream (SSE), Better Auth at `/api/auth/*`, downloads and OAuth
// callbacks. Streaming needs the Node runtime and no caching
// (docs/decisions/0004).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handle = async (request: Request): Promise<Response> => {
  const boot = await getServer();
  if (!boot.ok) {
    return Response.json(
      {
        code: "INTERNAL_SERVER_ERROR",
        defined: false,
        message: `The server's configuration is invalid.\n${boot.message}`,
        status: 500,
      },
      { status: 500 }
    );
  }
  return boot.server.app.fetch(request);
};

export const DELETE = handle;
export const GET = handle;
export const HEAD = handle;
export const OPTIONS = handle;
export const PATCH = handle;
export const POST = handle;
export const PUT = handle;
