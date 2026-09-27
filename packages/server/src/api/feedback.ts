import { implement, ORPCError } from "@orpc/server";
import { contract } from "@workspace/contract/contract";
import type { MessageId } from "@workspace/contract/schemas/common";
import type { Db } from "@workspace/db/client";
import {
  deleteFeedback,
  getFeedback,
  setFeedback,
  toFeedback,
} from "@workspace/db/queries/feedback";
import { getMessage } from "@workspace/db/queries/messages";

import {
  type Actor,
  actorFor,
  type ConversationAccess,
  type RequestContext,
} from "../context";

// The `feedback` procedure group (D21, M1 production quality): thumbs up or
// down on an assistant message, an optional comment, and the "share this
// conversation with the agent's maintainers" opt-in. Anyone who can read the
// chat may rate its answers; each person's rating is their own.

export const createFeedbackRouter = (db: Db, access: ConversationAccess) => {
  const os = implement(contract).$context<RequestContext>();
  const authed = os.use(async ({ context, next }) => {
    if (!context.session) {
      throw new ORPCError("UNAUTHORIZED");
    }
    return next({ context: { actor: await actorFor(db, context.session) } });
  });

  /** The message, if the caller can read its chat; `NOT_FOUND` otherwise, so ids don't leak. */
  const readableMessage = async (actor: Actor, id: MessageId) => {
    const found = await getMessage(db, id);
    if (
      !(found.ok && (await access(actor, found.value.conversationId, "read")))
    ) {
      throw new ORPCError("NOT_FOUND");
    }
    return found.value;
  };

  const feedback = {
    delete: authed.feedback.delete.handler(async ({ context, input }) => {
      await readableMessage(context.actor, input.messageId);
      await deleteFeedback(db, input.messageId, context.actor.userId);
    }),

    get: authed.feedback.get.handler(async ({ context, input }) => {
      await readableMessage(context.actor, input.messageId);
      const row = await getFeedback(db, input.messageId, context.actor.userId);
      return row ? toFeedback(row) : null;
    }),

    set: authed.feedback.set.handler(async ({ context, errors, input }) => {
      const message = await readableMessage(context.actor, input.messageId);
      if (message.role !== "assistant") {
        throw errors.VALIDATION({
          data: {
            issues: [
              {
                message: "Only answers can be rated.",
                path: ["messageId"],
              },
            ],
          },
        });
      }
      const saved = await setFeedback(db, {
        comment: input.comment === "" ? null : input.comment,
        messageId: input.messageId,
        rating: input.rating,
        shareWithMaintainers: input.shareWithMaintainers,
        userId: context.actor.userId,
      });
      if (!saved.ok) {
        throw new ORPCError("NOT_FOUND");
      }
      return toFeedback(saved.value);
    }),
  };

  return { feedback };
};
