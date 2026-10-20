import type {
  ConversationId,
  LibraryItemId,
  UserId,
} from "@workspace/contract/schemas/common";
import { type AsyncResult, err, ok } from "@workspace/shared/result";
import { and, eq, ne, sql } from "drizzle-orm";

import type { Db } from "../client";
import { type NotFoundError, notFound } from "../errors";
import {
  mcpConnectorPref,
  mcpConversationConnector,
  mcpOauthToken,
  mcpServer,
  type ToolChoices,
} from "../schema/library";
import type { McpServerRow } from "./library";

// MCP connection state (ticket 018, D13, D24). Saved servers are written by
// the library queries; these are the reads the connection manager needs,
// plus each user's OAuth tokens. Tokens arrive sealed (AES-GCM under
// ENCRYPTION_KEY, done by `@workspace/mcp`): the database never sees one in
// the clear. Access (ownership, grants) is checked by the caller.

export type McpOauthTokenRow = typeof mcpOauthToken.$inferSelect;

/** One saved server, secret still sealed. */
export const getMcpServer = async (
  db: Db,
  id: LibraryItemId
): AsyncResult<McpServerRow, NotFoundError> => {
  const [row] = await db
    .select()
    .from(mcpServer)
    .where(eq(mcpServer.id, id))
    .limit(1);
  return row ? ok(row) : err(notFound("mcp_server", id));
};

/** A user's sealed tokens for a server, or `undefined` if they never authorised it. */
export const getMcpOauthToken = async (
  db: Db,
  mcpServerId: LibraryItemId,
  userId: UserId
): Promise<McpOauthTokenRow | undefined> => {
  const [row] = await db
    .select()
    .from(mcpOauthToken)
    .where(
      and(
        eq(mcpOauthToken.mcpServerId, mcpServerId),
        eq(mcpOauthToken.userId, userId)
      )
    )
    .limit(1);
  return row;
};

export interface SealedMcpOauthToken {
  readonly ciphertext: string;
  /** When the access token stops working, if the server said. */
  readonly expiresAt: Date | null;
  /** Which encryption key sealed it. */
  readonly keyId: string;
  readonly mcpServerId: LibraryItemId;
  readonly userId: UserId;
}

/** Stores a user's tokens for a server, replacing any they had. */
export const upsertMcpOauthToken = async (
  db: Db,
  input: SealedMcpOauthToken
): Promise<McpOauthTokenRow> => {
  const [row] = await db
    .insert(mcpOauthToken)
    .values(input)
    .onConflictDoUpdate({
      set: {
        ciphertext: input.ciphertext,
        expiresAt: input.expiresAt,
        keyId: input.keyId,
        updatedAt: new Date(),
      },
      target: [mcpOauthToken.mcpServerId, mcpOauthToken.userId],
    })
    .returning();
  if (!row) {
    throw new Error("upsert returned no row");
  }
  return row;
};

/** Forgets a user's tokens for a server. True if there were any. */
export const deleteMcpOauthToken = async (
  db: Db,
  mcpServerId: LibraryItemId,
  userId: UserId
): Promise<boolean> => {
  const rows = await db
    .delete(mcpOauthToken)
    .where(
      and(
        eq(mcpOauthToken.mcpServerId, mcpServerId),
        eq(mcpOauthToken.userId, userId)
      )
    )
    .returning({ userId: mcpOauthToken.userId });
  return rows.length > 0;
};

/** Tokens sealed with something other than `currentKeyId`: what rotation must reseal. */
export const listMcpOauthTokensToReseal = (
  db: Db,
  currentKeyId: string
): Promise<McpOauthTokenRow[]> =>
  db.select().from(mcpOauthToken).where(ne(mcpOauthToken.keyId, currentKeyId));

// --- Connector choices (184, 188): each user's on/off per server and tool,
// and a chat's choices layered on top ---

/** One layer's choice for a server: `enabled` null follows the layer below. */
export interface ConnectorChoice {
  readonly enabled: boolean | null;
  readonly tools: ToolChoices;
}

export type ConnectorChoices = ReadonlyMap<LibraryItemId, ConnectorChoice>;

const byServer = (
  rows: readonly {
    readonly enabled: boolean | null;
    readonly mcpServerId: LibraryItemId;
    readonly tools: ToolChoices;
  }[]
): ConnectorChoices =>
  new Map(
    rows.map((row) => [
      row.mcpServerId,
      { enabled: row.enabled, tools: row.tools },
    ])
  );

/** The user's stored defaults, by server id. */
export const listConnectorPrefs = async (
  db: Db,
  userId: UserId
): Promise<ConnectorChoices> =>
  byServer(
    await db
      .select({
        enabled: mcpConnectorPref.enabled,
        mcpServerId: mcpConnectorPref.mcpServerId,
        tools: mcpConnectorPref.tools,
      })
      .from(mcpConnectorPref)
      .where(eq(mcpConnectorPref.userId, userId))
  );

/** One tool switch merged into a stored `tools` object. */
const withTool = (
  column: typeof mcpConnectorPref.tools | typeof mcpConversationConnector.tools,
  tool: string,
  enabled: boolean
) => sql`${column} || jsonb_build_object(${tool}::text, ${enabled}::boolean)`;

/** Stores the user's default for one server, replacing any earlier one. */
export const setConnectorPref = async (
  db: Db,
  input: {
    readonly enabled: boolean;
    readonly mcpServerId: LibraryItemId;
    readonly userId: UserId;
  }
): Promise<void> => {
  await db
    .insert(mcpConnectorPref)
    .values(input)
    .onConflictDoUpdate({
      set: { enabled: input.enabled, updatedAt: new Date() },
      target: [mcpConnectorPref.userId, mcpConnectorPref.mcpServerId],
    });
};

interface ToolSwitch {
  readonly enabled: boolean;
  readonly mcpServerId: LibraryItemId;
  readonly tool: string;
  readonly userId: UserId;
}

/** Stores the user's default for one tool, leaving the server's switch alone. */
export const setConnectorToolPref = async (
  db: Db,
  input: ToolSwitch
): Promise<void> => {
  await db
    .insert(mcpConnectorPref)
    .values({
      enabled: null,
      mcpServerId: input.mcpServerId,
      tools: { [input.tool]: input.enabled },
      userId: input.userId,
    })
    .onConflictDoUpdate({
      set: {
        tools: withTool(mcpConnectorPref.tools, input.tool, input.enabled),
        updatedAt: new Date(),
      },
      target: [mcpConnectorPref.userId, mcpConnectorPref.mcpServerId],
    });
};

interface ChatScope {
  readonly conversationId: ConversationId;
  readonly userId: UserId;
}

const inChat = (scope: ChatScope) =>
  and(
    eq(mcpConversationConnector.conversationId, scope.conversationId),
    eq(mcpConversationConnector.userId, scope.userId)
  );

const chatTarget = [
  mcpConversationConnector.conversationId,
  mcpConversationConnector.userId,
  mcpConversationConnector.mcpServerId,
];

/** One user's choices for one chat, by server id. */
export const listConversationConnectors = async (
  db: Db,
  scope: ChatScope
): Promise<ConnectorChoices> =>
  byServer(
    await db
      .select({
        enabled: mcpConversationConnector.enabled,
        mcpServerId: mcpConversationConnector.mcpServerId,
        tools: mcpConversationConnector.tools,
      })
      .from(mcpConversationConnector)
      .where(inChat(scope))
  );

/** Stores a chat's choice for one server. */
export const setConversationConnector = async (
  db: Db,
  input: ChatScope & {
    readonly enabled: boolean;
    readonly mcpServerId: LibraryItemId;
  }
): Promise<void> => {
  await db
    .insert(mcpConversationConnector)
    .values(input)
    .onConflictDoUpdate({
      set: { enabled: input.enabled, updatedAt: new Date() },
      target: chatTarget,
    });
};

/** Stores a chat's choice for one tool. */
export const setConversationConnectorTool = async (
  db: Db,
  input: ChatScope & ToolSwitch
): Promise<void> => {
  await db
    .insert(mcpConversationConnector)
    .values({
      conversationId: input.conversationId,
      enabled: null,
      mcpServerId: input.mcpServerId,
      tools: { [input.tool]: input.enabled },
      userId: input.userId,
    })
    .onConflictDoUpdate({
      set: {
        tools: withTool(
          mcpConversationConnector.tools,
          input.tool,
          input.enabled
        ),
        updatedAt: new Date(),
      },
      target: chatTarget,
    });
};

/** Forgets one user's choices for a chat: it follows their defaults again. */
export const resetConversationConnectors = async (
  db: Db,
  scope: ChatScope
): Promise<void> => {
  await db.delete(mcpConversationConnector).where(inChat(scope));
};
