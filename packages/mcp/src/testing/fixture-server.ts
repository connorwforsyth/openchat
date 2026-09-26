import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

// A real MCP server for tests, in-process on an ephemeral port: the MCP
// SDK's server over Streamable HTTP (stateful sessions, so a restart really
// forgets them) and legacy SSE, plus an optional minimal OAuth 2.1
// authorization server on the same origin (RFC 9728 and RFC 8414
// discovery, dynamic registration, PKCE S256, refresh). Consent is a
// function call: `approve()` plays the user clicking "Allow".
//
// Tools: `echo`, `add`, and `whoami` (who the bearer token belongs to), so
// tests can see which user's credentials a call carried.

export interface McpFixtureOptions {
  /** Access token lifetime when OAuth is on. */
  readonly accessTokenTtlSeconds?: number;
  /** Protect `/mcp` with OAuth. */
  readonly oauth?: boolean;
  /** Require this header on `/mcp` (header-secret servers). */
  readonly requireHeader?: { readonly name: string; readonly value: string };
}

export interface McpFixtureStats {
  /** `initialize` requests that opened a session. */
  initializes: number;
  registrations: number;
  tokenGrants: string[];
  toolCalls: number;
}

export interface McpFixture {
  /** Plays the user approving the sign-in; returns the callback query. */
  readonly approve: (
    authorizationUrl: string | URL,
    identity: string
  ) => URLSearchParams;
  readonly close: () => Promise<void>;
  /** Expires every access token (refresh tokens still work). */
  readonly expireAccessTokens: () => void;
  /** Forgets every session but keeps serving (what a load-balanced restart looks like). */
  readonly forgetSessions: () => void;
  readonly origin: string;
  /** Stops and starts on the same port; every session is forgotten. */
  readonly restart: () => Promise<void>;
  readonly sseUrl: string;
  readonly stats: McpFixtureStats;
  readonly url: string;
}

interface Grant {
  readonly expiresAt: number;
  readonly identity: string;
}

const readBody = async (req: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
};

const sendJson = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

const s256 = (verifier: string) =>
  createHash("sha256").update(verifier).digest("base64url");

const isInitialize = (body: unknown) =>
  typeof body === "object" &&
  body !== null &&
  "method" in body &&
  body.method === "initialize";

export const startMcpFixture = async (
  options: McpFixtureOptions = {}
): Promise<McpFixture> => {
  const stats: McpFixtureStats = {
    initializes: 0,
    registrations: 0,
    tokenGrants: [],
    toolCalls: 0,
  };
  const ttl = options.accessTokenTtlSeconds ?? 3600;
  const clients = new Map<string, { redirectUris: string[] }>();
  const codes = new Map<
    string,
    {
      challenge: string;
      clientId: string;
      identity: string;
      redirectUri: string;
    }
  >();
  const accessTokens = new Map<string, Grant>();
  const refreshTokens = new Map<string, string>();
  let sessions = new Map<string, StreamableHTTPServerTransport>();
  let sseSessions = new Map<string, SSEServerTransport>();
  let origin = "";

  const buildServer = () => {
    const server = new McpServer({ name: "fixture", version: "1.0.0" });
    server.registerTool(
      "echo",
      {
        description: "Echoes the text back.",
        inputSchema: { text: z.string() },
      },
      ({ text }) => {
        stats.toolCalls += 1;
        return { content: [{ text, type: "text" }] };
      }
    );
    server.registerTool(
      "add",
      {
        description: "Adds two numbers.",
        inputSchema: { a: z.number(), b: z.number() },
      },
      ({ a, b }) => {
        stats.toolCalls += 1;
        return { content: [{ text: String(a + b), type: "text" }] };
      }
    );
    server.registerTool(
      "whoami",
      { description: "Who the credentials belong to." },
      (extra) => {
        stats.toolCalls += 1;
        const identity =
          (extra.authInfo?.extra?.identity as string | undefined) ??
          "anonymous";
        return { content: [{ text: identity, type: "text" }] };
      }
    );
    return server;
  };

  const issueTokens = (identity: string) => {
    const access = randomBytes(16).toString("hex");
    const refresh = randomBytes(16).toString("hex");
    accessTokens.set(access, { expiresAt: Date.now() + ttl * 1000, identity });
    refreshTokens.set(refresh, identity);
    return {
      access_token: access,
      expires_in: ttl,
      refresh_token: refresh,
      token_type: "Bearer",
    };
  };

  const tokenResponse = (form: URLSearchParams): [number, unknown] => {
    const grantType = form.get("grant_type") ?? "";
    stats.tokenGrants.push(grantType);
    if (grantType === "authorization_code") {
      const code = codes.get(form.get("code") ?? "");
      codes.delete(form.get("code") ?? "");
      const valid =
        code !== undefined &&
        code.clientId === form.get("client_id") &&
        code.redirectUri === form.get("redirect_uri") &&
        code.challenge === s256(form.get("code_verifier") ?? "");
      return valid
        ? [200, issueTokens(code.identity)]
        : [400, { error: "invalid_grant" }];
    }
    if (grantType === "refresh_token") {
      const token = form.get("refresh_token") ?? "";
      const identity = refreshTokens.get(token);
      refreshTokens.delete(token);
      return identity
        ? [200, issueTokens(identity)]
        : [400, { error: "invalid_grant" }];
    }
    return [400, { error: "unsupported_grant_type" }];
  };

  const oauthRoutes: Record<
    string,
    (req: IncomingMessage, res: ServerResponse) => Promise<void> | void
  > = {
    "GET /.well-known/oauth-authorization-server": (_req, res) =>
      sendJson(res, 200, {
        authorization_endpoint: `${origin}/authorize`,
        code_challenge_methods_supported: ["S256"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        issuer: origin,
        registration_endpoint: `${origin}/register`,
        response_types_supported: ["code"],
        token_endpoint: `${origin}/token`,
        token_endpoint_auth_methods_supported: ["none"],
      }),
    "GET /.well-known/oauth-protected-resource/mcp": (_req, res) =>
      sendJson(res, 200, {
        authorization_servers: [origin],
        resource: `${origin}/mcp`,
      }),
    "POST /register": async (req, res) => {
      const body = JSON.parse(await readBody(req)) as {
        redirect_uris: string[];
      };
      const clientId = `client-${randomUUID()}`;
      clients.set(clientId, { redirectUris: body.redirect_uris });
      stats.registrations += 1;
      sendJson(res, 201, { ...body, client_id: clientId });
    },
    "POST /token": async (req, res) => {
      const [status, body] = tokenResponse(
        new URLSearchParams(await readBody(req))
      );
      sendJson(res, status, body);
    },
  };

  const bearerGrant = (req: IncomingMessage): Grant | undefined => {
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    const grant = accessTokens.get(token);
    return grant && grant.expiresAt > Date.now() ? grant : undefined;
  };

  const handleMcp = async (
    req: IncomingMessage & {
      auth?: {
        clientId: string;
        extra: Record<string, unknown>;
        scopes: string[];
        token: string;
      };
    },
    res: ServerResponse
  ) => {
    if (options.oauth) {
      const grant = bearerGrant(req);
      if (!grant) {
        res.writeHead(401, {
          "www-authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`,
        });
        res.end();
        return;
      }
      req.auth = {
        clientId: "fixture",
        extra: { identity: grant.identity },
        scopes: [],
        token: "redacted",
      };
    }
    if (
      options.requireHeader &&
      req.headers[options.requireHeader.name.toLowerCase()] !==
        options.requireHeader.value
    ) {
      res.writeHead(401);
      res.end();
      return;
    }
    const raw = req.method === "POST" ? await readBody(req) : "";
    const body = raw === "" ? undefined : JSON.parse(raw);
    const sessionId = req.headers["mcp-session-id"];
    if (typeof sessionId === "string") {
      const transport = sessions.get(sessionId);
      if (!transport) {
        sendJson(res, 404, {
          error: { code: -32_001, message: "Session not found" },
          id: null,
          jsonrpc: "2.0",
        });
        return;
      }
      await transport.handleRequest(req, res, body);
      return;
    }
    if (req.method === "POST" && isInitialize(body)) {
      const transport: StreamableHTTPServerTransport =
        new StreamableHTTPServerTransport({
          onsessioninitialized: (id) => {
            sessions.set(id, transport);
          },
          sessionIdGenerator: () => randomUUID(),
        });
      stats.initializes += 1;
      await buildServer().connect(transport);
      await transport.handleRequest(req, res, body);
      return;
    }
    sendJson(res, 400, {
      error: { code: -32_000, message: "No session" },
      id: null,
      jsonrpc: "2.0",
    });
  };

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", origin);
    const oauthRoute = options.oauth
      ? oauthRoutes[`${req.method} ${url.pathname}`]
      : undefined;
    if (oauthRoute) {
      await oauthRoute(req, res);
      return;
    }
    if (url.pathname === "/mcp") {
      await handleMcp(req, res);
      return;
    }
    if (url.pathname === "/sse" && req.method === "GET") {
      const transport = new SSEServerTransport("/messages", res);
      sseSessions.set(transport.sessionId, transport);
      stats.initializes += 1;
      await buildServer().connect(transport);
      return;
    }
    if (url.pathname === "/messages" && req.method === "POST") {
      const transport = sseSessions.get(
        url.searchParams.get("sessionId") ?? ""
      );
      if (!transport) {
        res.writeHead(404);
        res.end();
        return;
      }
      await transport.handlePostMessage(req, res);
      return;
    }
    res.writeHead(404);
    res.end();
  };

  let server: Server | undefined;
  const listen = (onPort: number) =>
    new Promise<number>((resolve, reject) => {
      const next = createServer((req, res) => {
        handle(req, res).catch(() => {
          if (!res.headersSent) {
            res.writeHead(500);
          }
          res.end();
        });
      });
      next.once("error", reject);
      next.listen(onPort, "127.0.0.1", () => {
        server = next;
        resolve((next.address() as AddressInfo).port);
      });
    });
  const stop = () =>
    new Promise<void>((resolve) => {
      const current = server;
      server = undefined;
      if (!current) {
        resolve();
        return;
      }
      current.close(() => resolve());
      current.closeAllConnections();
    });

  const port = await listen(0);
  origin = `http://127.0.0.1:${port}`;

  return {
    approve: (authorizationUrl, identity) => {
      const url = new URL(authorizationUrl);
      const clientId = url.searchParams.get("client_id") ?? "";
      const redirectUri = url.searchParams.get("redirect_uri") ?? "";
      if (
        url.searchParams.get("code_challenge_method") !== "S256" ||
        !clients.get(clientId)?.redirectUris.includes(redirectUri)
      ) {
        throw new Error("fixture: not a valid authorization request");
      }
      const code = randomBytes(16).toString("hex");
      codes.set(code, {
        challenge: url.searchParams.get("code_challenge") ?? "",
        clientId,
        identity,
        redirectUri,
      });
      const query = new URLSearchParams({ code });
      const state = url.searchParams.get("state");
      if (state !== null) {
        query.set("state", state);
      }
      return query;
    },
    close: stop,
    expireAccessTokens: () => {
      for (const [token, grant] of accessTokens) {
        accessTokens.set(token, { ...grant, expiresAt: 0 });
      }
    },
    forgetSessions: () => {
      sessions = new Map();
    },
    origin,
    restart: async () => {
      await stop();
      sessions = new Map();
      sseSessions = new Map();
      await listen(port);
    },
    sseUrl: `${origin}/sse`,
    stats,
    url: `${origin}/mcp`,
  };
};
