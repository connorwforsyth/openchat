import {
  type ConversationId,
  userIdSchema,
} from "@workspace/contract/schemas/common";
import type { ConversationPermission } from "@workspace/contract/schemas/conversations";
import type { Principal } from "@workspace/contract/schemas/tenancy";
import type { Db } from "@workspace/db/client";
import { getConversation } from "@workspace/db/queries/conversations";
import { loadPrincipals } from "@workspace/db/queries/teams";
import { z } from "zod";

// Who is calling and what they may do. The server doesn't own sign-in (ticket
// 012 does): it takes a session resolver and an access check as dependencies,
// so the auth package plugs in at integration (025) without this package
// importing it.

export const sessionSchema = z.object({ userId: userIdSchema });
export type Session = z.infer<typeof sessionSchema>;

/** Reads the caller from a request (cookie or bearer token); `null` when signed out. */
export type SessionResolver = (request: Request) => Promise<Session | null>;

/** The oRPC context every procedure starts from. */
export interface RequestContext {
  readonly request: Request;
  readonly session: Session | null;
}

/** What a caller may do in a conversation: read it, or prompt and change it. */
export type AccessLevel = "read" | "write";

/** The user and the principals they act as, for grant checks. */
export interface Actor {
  readonly principals: readonly Principal[];
  readonly userId: Session["userId"];
}

/**
 * Whether `actor` may act on a conversation at `level`. 025 passes 012's
 * `checkAccess`; the default below is the grant-aware check 011's queries
 * already do.
 */
export type ConversationAccess = (
  actor: Actor,
  conversationId: ConversationId,
  level: AccessLevel
) => Promise<boolean>;

const WRITERS: ReadonlySet<ConversationPermission> = new Set([
  "owner",
  "editor",
]);

/**
 * The default access check: ownership plus `resource_grant` rows held by the
 * actor's principals (D25), read through `getConversation`'s permission.
 */
export const grantAccess =
  (db: Db): ConversationAccess =>
  async (actor, conversationId, level) => {
    const found = await getConversation(db, conversationId, actor);
    if (!found.ok) {
      return false;
    }
    const permission = found.value.myPermission;
    if (permission === null) {
      return false;
    }
    return level === "read" || WRITERS.has(permission);
  };

export const actorFor = async (db: Db, session: Session): Promise<Actor> => ({
  principals: await loadPrincipals(db, session.userId),
  userId: session.userId,
});
