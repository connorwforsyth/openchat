import { implement, ORPCError } from "@orpc/server";
import { contract } from "@workspace/contract/contract";
import { baseErrors } from "@workspace/contract/errors";
import type {
  ArtifactId,
  ConversationId,
} from "@workspace/contract/schemas/common";
import type { Db } from "@workspace/db/client";
import {
  getArtifact,
  getArtifactVersion,
  listArtifacts,
  listArtifactVersions,
  toArtifact,
  toArtifactVersion,
} from "@workspace/db/queries/artifacts";

import {
  type Actor,
  actorFor,
  type ConversationAccess,
  type RequestContext,
} from "../context";

// The `artifacts` procedure group: documents, pages and snippets a chat
// produced, and their versions for the before/after diff. Whoever can read
// the conversation can read its artifacts; anyone else gets `NOT_FOUND`, so
// ids don't leak.

export interface ArtifactsDeps {
  readonly access: ConversationAccess;
  readonly db: Db;
}

const notFound = () => new ORPCError("NOT_FOUND", baseErrors.NOT_FOUND);

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

  /** The artifact, if the caller can read its chat. */
  const readableArtifact = async (actor: Actor, id: ArtifactId) => {
    const found = await getArtifact(db, id);
    if (!found.ok) {
      throw notFound();
    }
    await requireReadable(actor, found.value.conversationId);
    return found.value;
  };

  const artifacts = {
    get: authed.artifacts.get.handler(async ({ context, input }) =>
      toArtifact(await readableArtifact(context.actor, input.id))
    ),

    getVersion: authed.artifacts.getVersion.handler(
      async ({ context, input }) => {
        await readableArtifact(context.actor, input.id);
        const version = await getArtifactVersion(db, input.id, input.versionId);
        if (!version.ok) {
          throw notFound();
        }
        return toArtifactVersion(version.value);
      }
    ),

    list: authed.artifacts.list.handler(async ({ context, input }) => {
      await requireReadable(context.actor, input.conversationId);
      return (await listArtifacts(db, input.conversationId)).map(toArtifact);
    }),

    listVersions: authed.artifacts.listVersions.handler(
      async ({ context, input }) => {
        await readableArtifact(context.actor, input.id);
        return (await listArtifactVersions(db, input.id)).map(
          toArtifactVersion
        );
      }
    ),
  };

  return { artifacts };
};
