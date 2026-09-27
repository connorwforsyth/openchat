import { handleOAuthCallback } from "@workspace/mcp/handlers";
import type { McpManager } from "@workspace/mcp/manager";
import type { Hono } from "hono";

import type { SessionResolver } from "../context";
import { problem } from "./problem";

// The MCP OAuth callback (018): the provider sends the browser here after
// sign-in. It isn't a procedure (a browser lands on it), so it answers with
// a tiny page that tells the window that opened it and closes itself; the
// settings page re-reads the server's status either way.

const page = (ok: boolean, message: string) => {
  const payload = JSON.stringify({ message, ok, type: "mcp-oauth" }).replaceAll(
    "<",
    "\\u003c"
  );
  const text = message.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>MCP</title><p>${text}</p><script>try{window.opener&&window.opener.postMessage(${payload},location.origin)}finally{window.close()}</script>`,
    {
      headers: {
        "cache-control": "no-store",
        "content-security-policy":
          "default-src 'none'; script-src 'unsafe-inline'",
        "content-type": "text/html; charset=utf-8",
      },
      status: ok ? 200 : 400,
    }
  );
};

export const MCP_OAUTH_CALLBACK_PATH = "/api/mcp/oauth/callback";

export const mountMcpRoutes = (
  app: Hono,
  {
    manager,
    resolveSession,
  }: { readonly manager: McpManager; readonly resolveSession: SessionResolver }
) => {
  app.get(MCP_OAUTH_CALLBACK_PATH, async (c) => {
    const session = await resolveSession(c.req.raw);
    if (!session) {
      return problem(401, "UNAUTHORIZED", "Sign in to continue.");
    }
    const result = await handleOAuthCallback(
      { manager, session },
      new URL(c.req.url).searchParams
    );
    return result.ok
      ? page(true, "Connected. You can close this window.")
      : page(false, result.message);
  });
};
