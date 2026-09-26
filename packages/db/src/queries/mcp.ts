import type { LibraryItemId, UserId } from "@workspace/contract/schemas/common";
import { type AsyncResult, err, ok } from "@workspace/shared/result";
import { and, eq, ne } from "drizzle-orm";

import type { Db } from "../client";
import { type NotFoundError, notFound } from "../errors";
import { mcpOauthToken, mcpServer } from "../schema/library";
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
