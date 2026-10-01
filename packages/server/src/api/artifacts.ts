import { implement, ORPCError } from "@orpc/server";
import { contract } from "@workspace/contract/contract";
import { baseErrors } from "@workspace/contract/errors";
import type {
  ArtifactId,
  ConversationId,
  OrgId,
  TeamId,
  UserId,
} from "@workspace/contract/schemas/common";
import type {
  ArtifactAccess,
  ArtifactListItem,
} from "@workspace/contract/schemas/files";
import type { Principal } from "@workspace/contract/schemas/tenancy";
import type { Db } from "@workspace/db/client";
import {
  type ArtifactRow,
  artifactAccessOf,
  artifactPageFacts,
  attachArtifactToChat,
  conversationOwners,
  deleteArtifact,
  deleteArtifactGrant,
  duplicateArtifact,
  getArtifact,
  getArtifactGrant,
  getArtifactVersion,
  listArtifactGrants,
  listArtifactPage,
  listArtifactUses,
  listArtifactVersions,
  listChatArtifacts,
  markArtifactViewed,
  renameArtifact,
  toArtifact,
  toArtifactGrant,
  toArtifactVersion,
  upsertArtifactGrant,
} from "@workspace/db/queries/artifacts";
import { decodeCursor } from "@workspace/db/queries/page";
import { member, user } from "@workspace/db/schema/auth";
import { team } from "@workspace/db/schema/tenancy";
import { and, eq } from "drizzle-orm";

import {
  type Actor,
  actorFor,
  type ConversationAccess,
  type RequestContext,
} from "../context";
import { forbiddenError, validationError } from "./errors";

// The `artifacts` procedure group: documents, pages and snippets a chat
// produced, and their versions for the before/after diff. Since 124 an
// artifact is owned by a person and shared on its own (`artifact_grant`),
// and it can be used in other chats. Whoever owns it, holds a share, or can
// read a chat it was made or used in can read it; anyone else gets
// `NOT_FOUND`, so ids don't leak.

export interface ArtifactsDeps {
  readonly access: ConversationAccess;
  readonly db: Db;
}

const notFound = () => new ORPCError("NOT_FOUND", baseErrors.NOT_FOUND);

const MAX_TITLE = 200;

/** What a duplicate is called: the source's title, marked as a copy. */
export const copyTitle = (title: string): string => {
  const marked = `${title} (copy)`;
  return marked.length <= MAX_TITLE ? marked : title;
};

/**
 * Whether `sharer` may share with `principal`: any existing user, or a team
 * or org the sharer belongs to (sharing into an org you're not in would
 * reach its members uninvited). The same rule as `grants.create`.
 */
const mayShareWith = async (
  db: Db,
  sharer: UserId,
  principal: Principal
): Promise<boolean> => {
  const memberOf = async (orgId: OrgId) => {
    const [row] = await db
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.organizationId, orgId), eq(member.userId, sharer)));
    return row !== undefined;
  };
  switch (principal.type) {
    case "user": {
      const [row] = await db
        .select({ id: user.id })
        .from(user)
        .where(eq(user.id, principal.id));
      return row !== undefined;
    }
    case "org":
      return memberOf(principal.id);
    case "team": {
      const [row] = await db
        .select({ orgId: team.orgId })
        .from(team)
        .where(eq(team.id, principal.id as TeamId));
      return row !== undefined && memberOf(row.orgId as OrgId);
    }
    default:
      return principal satisfies never;
  }
};

export const createArtifactsRouter = ({ access, db }: ArtifactsDeps) => {
  const os = implement(contract).$context<RequestContext>();
  const authed = os.use(async ({ context, next }) => {
    if (!context.session) {
      throw new ORPCError("UNAUTHORIZED", baseErrors.UNAUTHORIZED);
    }
    return next({ context: { actor: await actorFor(db, context.session) } });
  });

  const requireReadable = async (
    actor: Actor,
    conversationId: ConversationId
  ) => {
    if (!(await access(actor, conversationId, "read"))) {
      throw notFound();
    }
  };

  /** Whether the caller can open a chat; its owner always can, cheaply. */
  const chatOpener = (actor: Actor) => {
    const known = new Map<ConversationId, Promise<boolean>>();
    return (conversationId: ConversationId, ownerId?: UserId) => {
      if (ownerId === actor.userId) {
        return Promise.resolve(true);
      }
      let found = known.get(conversationId);
      if (!found) {
        found = access(actor, conversationId, "read");
        known.set(conversationId, found);
      }
      return found;
    };
  };

  /**
   * The caller's access: ownership or a share first, else `viewer` through
   * a chat they can read that made it or uses it; `null` when none.
   */
  const accessTo = async (
    actor: Actor,
    row: ArtifactRow
  ): Promise<ArtifactAccess | null> => {
    const direct = await artifactAccessOf(db, row.id, actor);
    if (direct) {
      return direct;
    }
    // Through a chat: the one that made it, or any it's used in.
    const chats = [row.conversationId, ...(await listArtifactUses(db, row.id))];
    const reads = await Promise.all(
      chats.map((conversationId) => access(actor, conversationId, "read"))
    );
    if (reads.some(Boolean)) {
      return "viewer";
    }
    return null;
  };

  /** The artifact and the caller's access, if they have any. */
  const readable = async (actor: Actor, id: ArtifactId) => {
    const found = await getArtifact(db, id);
    if (!found.ok) {
      throw notFound();
    }
    const level = await accessTo(actor, found.value);
    if (!level) {
      throw notFound();
    }
    return { access: level, row: found.value };
  };

  /** Needs ownership: anyone else who can see it is `FORBIDDEN`. */
  const owned = async (actor: Actor, id: ArtifactId) => {
    const found = await readable(actor, id);
    if (found.access !== "owner") {
      throw forbiddenError();
    }
    return found.row;
  };

  const listItem = async (
    actor: Actor,
    row: ArtifactRow,
    level: ArtifactAccess
  ): Promise<ArtifactListItem> => {
    const facts = await artifactPageFacts(db, row.id, actor.userId);
    if (!facts) {
      throw notFound();
    }
    const owners = await conversationOwners(db, [row.conversationId]);
    return {
      ...toArtifact(row),
      access: level,
      canGoToChat: await chatOpener(actor)(
        row.conversationId,
        owners.get(row.conversationId)
      ),
      ownerName: facts.ownerName,
      viewedAt: facts.viewedAt?.toISOString() ?? null,
      visibility: facts.shared ? "shared" : "private",
    };
  };

  const artifacts = {
    delete: authed.artifacts.delete.handler(async ({ context, input }) => {
      await owned(context.actor, input.id);
      await deleteArtifact(db, input.id);
    }),

    detail: authed.artifacts.detail.handler(async ({ context, input }) => {
      const found = await readable(context.actor, input.id);
      const [artifact, versions] = await Promise.all([
        listItem(context.actor, found.row, found.access),
        listArtifactVersions(db, input.id),
      ]);
      return { artifact, versions: versions.map(toArtifactVersion) };
    }),

    duplicate: authed.artifacts.duplicate.handler(
      async ({ context, input }) => {
        const found = await readable(context.actor, input.id);
        const copy = await duplicateArtifact(
          db,
          input.id,
          context.actor.userId,
          copyTitle(found.row.title)
        );
        if (!copy.ok) {
          // No version to copy.
          throw notFound();
        }
        return listItem(context.actor, copy.value, "owner");
      }
    ),

    get: authed.artifacts.get.handler(async ({ context, input }) =>
      toArtifact((await readable(context.actor, input.id)).row)
    ),

    getVersion: authed.artifacts.getVersion.handler(
      async ({ context, input }) => {
        await readable(context.actor, input.id);
        const version = await getArtifactVersion(db, input.id, input.versionId);
        if (!version.ok) {
          throw notFound();
        }
        return toArtifactVersion(version.value);
      }
    ),

    list: authed.artifacts.list.handler(async ({ context, input }) => {
      await requireReadable(context.actor, input.conversationId);
      return (await listChatArtifacts(db, input.conversationId)).map(
        toArtifact
      );
    }),

    listAll: authed.artifacts.listAll.handler(async ({ context, input }) => {
      const after = input.cursor ? decodeCursor(input.cursor) : undefined;
      if (after && !after.ok) {
        throw validationError([
          { message: "Unknown cursor.", path: ["cursor"] },
        ]);
      }
      const page = await listArtifactPage(db, {
        actor: context.actor,
        after: after?.value,
        kind: input.kind,
        limit: input.limit,
        query: input.query || undefined,
        scope: input.scope,
      });
      const owners = await conversationOwners(
        db,
        page.items.map((item) => item.artifact.conversationId)
      );
      const opens = chatOpener(context.actor);
      return {
        items: await Promise.all(
          page.items.map(
            async (item): Promise<ArtifactListItem> => ({
              ...toArtifact(item.artifact),
              access: item.access,
              canGoToChat: await opens(
                item.artifact.conversationId,
                owners.get(item.artifact.conversationId)
              ),
              ownerName: item.ownerName,
              viewedAt: item.viewedAt?.toISOString() ?? null,
              visibility: item.shared ? "shared" : "private",
            })
          )
        ),
        nextCursor: page.nextCursor,
      };
    }),

    listGrants: authed.artifacts.listGrants.handler(
      async ({ context, input }) => {
        await readable(context.actor, input.id);
        return (await listArtifactGrants(db, input.id)).map(toArtifactGrant);
      }
    ),

    listVersions: authed.artifacts.listVersions.handler(
      async ({ context, input }) => {
        await readable(context.actor, input.id);
        return (await listArtifactVersions(db, input.id)).map(
          toArtifactVersion
        );
      }
    ),

    markViewed: authed.artifacts.markViewed.handler(
      async ({ context, input }) => {
        await readable(context.actor, input.id);
        await markArtifactViewed(db, input.id, context.actor.userId);
      }
    ),

    rename: authed.artifacts.rename.handler(async ({ context, input }) => {
      const found = await readable(context.actor, input.id);
      if (found.access === "viewer") {
        throw forbiddenError();
      }
      const renamed = await renameArtifact(db, input.id, input.title);
      if (!renamed.ok) {
        throw notFound();
      }
      return listItem(context.actor, renamed.value, found.access);
    }),

    share: authed.artifacts.share.handler(async ({ context, input }) => {
      await owned(context.actor, input.id);
      const self =
        input.principal.type === "user" &&
        input.principal.id === context.actor.userId;
      if (
        self ||
        !(await mayShareWith(db, context.actor.userId, input.principal))
      ) {
        throw validationError([
          {
            message: "no such user, or a team or org you're not in",
            path: ["principal"],
          },
        ]);
      }
      return toArtifactGrant(
        await upsertArtifactGrant(db, {
          artifactId: input.id,
          grantedBy: context.actor.userId,
          permission: input.permission,
          principal: input.principal,
        })
      );
    }),

    unshare: authed.artifacts.unshare.handler(async ({ context, input }) => {
      const found = await readable(context.actor, input.id);
      const grant = await getArtifactGrant(db, input.id, input.grantId);
      if (!grant.ok) {
        throw notFound();
      }
      // Anyone may drop a share made to them personally.
      const own =
        grant.value.principalType === "user" &&
        grant.value.principalId === context.actor.userId;
      if (!own && found.access !== "owner") {
        throw forbiddenError();
      }
      await deleteArtifactGrant(db, input.grantId);
    }),

    use: authed.artifacts.use.handler(async ({ context, input }) => {
      const found = await readable(context.actor, input.id);
      if (!(await access(context.actor, input.conversationId, "write"))) {
        throw (await access(context.actor, input.conversationId, "read"))
          ? forbiddenError()
          : notFound();
      }
      if (found.row.conversationId === input.conversationId) {
        // Its own chat already has it.
        return;
      }
      await attachArtifactToChat(db, {
        addedBy: context.actor.userId,
        artifactId: input.id,
        conversationId: input.conversationId,
      });
    }),
  };

  return { artifacts };
};
