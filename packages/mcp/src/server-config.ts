import { createHash } from "node:crypto";

import { validateDownloadUrl } from "@ai-sdk/provider-utils";
import type { AppConfig } from "@workspace/config/schema";
import {
  type LibraryItemId,
  libraryItemIdSchema,
} from "@workspace/contract/schemas/common";
import { mcpAuthSchema } from "@workspace/contract/schemas/library";
import { principalSchema } from "@workspace/contract/schemas/tenancy";
import type { McpServerRow } from "@workspace/db/queries/library";
import { err, ok, type Result } from "@workspace/shared/result";
import { z } from "zod";

import { sealedSecretSchema } from "./crypto";
import type { McpError } from "./errors";

// One MCP server, however it was configured: instance-wide in
// app.config.yaml (D18) or saved in someone's MCP Library (D13), owned by a
// user, team or org (D17). This is the registry half of LibreChat's
// MCPServersRegistry, reduced to a pure mapping: the connection manager only
// ever sees this shape.

export const mcpServerScopeSchema = z.enum(["instance", "org", "team", "user"]);
export type McpServerScope = z.infer<typeof mcpServerScopeSchema>;

/**
 * Which of the server's tools to offer, by the server's own tool name.
 * Omitted `allow` means every tool; `deny` always wins.
 */
export const toolFilterSchema = z.object({
  allow: z.array(z.string()).readonly().optional(),
  deny: z.array(z.string()).readonly().default([]),
});
export type ToolFilter = z.infer<typeof toolFilterSchema>;

export const serverAuthSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  /** A static header; the value stays sealed until a connection opens it. */
  z.object({
    headerName: z.string().min(1),
    secret: sealedSecretSchema.nullable(),
    type: z.literal("header"),
  }),
  /** Each user authorises for themselves (per-user connections). */
  z.object({
    scopes: z.array(z.string()).readonly().default([]),
    type: z.literal("oauth"),
  }),
]);
export type ServerAuth = z.infer<typeof serverAuthSchema>;

export const mcpServerConfigSchema = z.object({
  auth: serverAuthSchema,
  /** Plain headers (instance servers; `${ENV}` already interpolated). */
  headers: z.record(z.string(), z.string()).default({}),
  id: libraryItemIdSchema,
  /** What the model sees before `__` in each tool name. */
  name: z.string().min(1),
  /** `null` for instance servers. */
  owner: principalSchema.nullable(),
  tools: toolFilterSchema.prefault({}),
  transport: z.enum(["http", "sse"]),
  /**
   * Written by an admin (app.config.yaml), not a user: may point at the
   * private network. Library servers never may, unless the manager allows it.
   */
  trusted: z.boolean(),
  url: z.url(),
  /** Changes whenever anything that affects a connection changes. */
  version: z.string(),
});
export type McpServerConfig = z.infer<typeof mcpServerConfigSchema>;

export const scopeOf = (
  server: Pick<McpServerConfig, "owner">
): McpServerScope => server.owner?.type ?? "instance";

const digest = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

const withVersion = (
  server: Omit<McpServerConfig, "version">
): McpServerConfig => ({
  ...server,
  version: digest([
    server.auth,
    server.headers,
    server.name,
    server.tools,
    server.transport,
    server.url,
  ]).slice(0, 16),
});

/**
 * Instance servers have no library row, but agents name servers by library
 * item id. A UUIDv8 (RFC 9562 "custom") hashed from the name gives each one
 * a stable id that can't collide with the app's UUIDv7s.
 */
export const instanceServerId = (name: string): LibraryItemId => {
  const hex = digest(`mcp-instance-server:${name}`);
  // RFC 9562 variant bits (10xx): one of 8, 9, a, b.
  const variant = "89ab"[Number.parseInt(hex[16] ?? "0", 16) % 4];
  return libraryItemIdSchema.parse(
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
  );
};

export type InstanceServerEntry = AppConfig["mcp"]["servers"][number];

export const fromInstanceConfig = (
  entry: InstanceServerEntry
): McpServerConfig =>
  withVersion({
    auth: { type: "none" },
    headers: entry.headers,
    id: instanceServerId(entry.name),
    name: entry.name,
    owner: null,
    tools: { deny: [] },
    transport: entry.transport,
    trusted: true,
    url: entry.url,
  });

// Rows are parsed leniently: an imported or older definition may carry a
// transport this surface doesn't run, and that should read as "not here",
// not as a crash.
const storedDefinitionSchema = z.object({
  auth: mcpAuthSchema.catch({ type: "none" }),
  transport: z.string(),
  url: z.string().optional(),
});

type LibraryRow = Pick<
  McpServerRow,
  | "definition"
  | "id"
  | "name"
  | "ownerId"
  | "ownerType"
  | "secretCiphertext"
  | "secretKeyId"
>;

export const fromLibraryRow = (
  row: LibraryRow
): Result<McpServerConfig, McpError> => {
  const definition = storedDefinitionSchema.safeParse(row.definition);
  if (!definition.success) {
    return err({
      message: "This MCP server's saved definition is invalid.",
      type: "unavailable",
    });
  }
  const { auth, transport, url } = definition.data;
  if (transport !== "http" && transport !== "sse") {
    return err({
      message:
        transport === "stdio"
          ? "stdio MCP servers run in the desktop app, not on the server."
          : `Unsupported MCP transport "${transport}".`,
      type: "unsupported_transport",
    });
  }
  const owner = principalSchema.safeParse({
    id: row.ownerId,
    type: row.ownerType,
  });
  const parsedUrl = z.url().safeParse(url);
  if (!(owner.success && parsedUrl.success)) {
    return err({
      message: "This MCP server's saved definition is invalid.",
      type: "unavailable",
    });
  }
  const secret =
    row.secretCiphertext !== null && row.secretKeyId !== null
      ? { ciphertext: row.secretCiphertext, keyId: row.secretKeyId }
      : null;
  let serverAuth: ServerAuth;
  switch (auth.type) {
    case "header":
      serverAuth = { headerName: auth.headerName, secret, type: "header" };
      break;
    case "oauth":
      serverAuth = { scopes: auth.scopes, type: "oauth" };
      break;
    default:
      serverAuth = { type: "none" };
  }
  return ok(
    withVersion({
      auth: serverAuth,
      headers: {},
      id: row.id,
      name: row.name,
      owner: owner.data,
      tools: { deny: [] },
      transport,
      trusted: false,
      url: parsedUrl.data,
    })
  );
};

/**
 * Whether each user gets a connection of their own. OAuth tokens are per
 * user, and a user-owned server's header secret is that user's; team, org
 * and instance servers with shared credentials share one connection
 * (LibreChat's app vs user connections).
 */
export const isPerUser = (
  server: Pick<McpServerConfig, "auth" | "owner">
): boolean => server.auth.type === "oauth" || scopeOf(server) === "user";

export const connectionKey = (
  server: Pick<McpServerConfig, "auth" | "id" | "owner">,
  userId: string
): string =>
  isPerUser(server) ? `user:${userId}:${server.id}` : `shared:${server.id}`;

/**
 * Library servers are user input the server fetches: refuse the private
 * network (SSRF) unless the instance says otherwise. Literal addresses only;
 * DNS answers are pinned per request by `fetchWithValidatedEndpoint`.
 */
export const checkServerUrl = (
  server: Pick<McpServerConfig, "trusted" | "url">,
  options: { readonly allowPrivateNetworks?: boolean } = {}
): Result<URL, McpError> => {
  const url = new URL(server.url);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return err({
      message: "MCP servers must use http or https.",
      type: "blocked_url",
    });
  }
  if (server.trusted || options.allowPrivateNetworks) {
    return ok(url);
  }
  try {
    validateDownloadUrl(url.href);
  } catch {
    return err({
      message: "This MCP server's address is on a private network.",
      type: "blocked_url",
    });
  }
  return ok(url);
};
