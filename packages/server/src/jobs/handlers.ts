import {
  fallbackTitle,
  generateTitle,
} from "@workspace/ai/title/generate-title";
import type { ConversationId } from "@workspace/contract/schemas/common";
import type { ChatContext } from "@workspace/contract/schemas/tenancy";
import type { Db } from "@workspace/db/client";
import {
  type ConversationView,
  getConversation,
  getConversationWithBranch,
  toChatContext,
  updateConversation,
} from "@workspace/db/queries/conversations";
import { toMessage } from "@workspace/db/queries/messages";
import { err, ok } from "@workspace/shared/result";
import type { LanguageModel } from "ai";

import { actorFor } from "../context";
import type { StreamChannel } from "../ports/stream-channel";
import { type JobHandlers, jobDefaults } from "./registry";

// The handlers this package owns: titles and stream pruning. Other
// workstreams add theirs to the same `JobHandlers` map at boot.

const TITLE_RETRIES = jobDefaults["title.generate"].retryLimit ?? 0;

export interface TitleModelRequest {
  readonly context: ChatContext;
  readonly conversationId: ConversationId;
  readonly signal: AbortSignal;
  readonly userId: Parameters<typeof actorFor>[1]["userId"];
}

export interface CoreJobDeps {
  readonly db: Db;
  readonly streams: StreamChannel;
  /** A cheap model for titles in this chat's context; `null` when none is available. */
  readonly titleModel: (
    request: TitleModelRequest
  ) => Promise<LanguageModel | null>;
}

/**
 * Titles are written as the system, so whoever the job names must be able
 * to rename the chat themselves: its owner or an editor. Reading it isn't
 * enough, or a viewer's run (or one whose grant was cut back after it was
 * enqueued) would rename someone else's chat.
 */
const canRename = (view: Pick<ConversationView, "myPermission">): boolean =>
  view.myPermission === "owner" || view.myPermission === "editor";

/** Whether to enqueue `title.generate` for this chat on `userId`'s behalf. */
export const shouldTitle = async (
  db: Db,
  conversationId: ConversationId,
  userId: TitleModelRequest["userId"]
): Promise<boolean> => {
  const actor = await actorFor(db, { userId });
  const found = await getConversation(db, conversationId, actor);
  return found.ok && found.value.title === null && canRename(found.value);
};

export const coreJobHandlers = ({
  db,
  streams,
  titleModel,
}: CoreJobDeps): JobHandlers => ({
  "run.prune": async (job) => {
    const pruned = await streams.prune(job.data.runId);
    return pruned.ok ? ok(undefined) : err(pruned.error.type);
  },

  "title.generate": async (job, signal) => {
    const { conversationId, userId } = job.data;
    const actor = await actorFor(db, { userId });
    const found = await getConversationWithBranch(db, conversationId, actor);
    if (!found.ok) {
      // Deleted since, or no longer shared with the author: nothing to name.
      return ok({ skipped: "not_found" });
    }
    const { branch, conversation } = found.value;
    if (!canRename(conversation)) {
      return ok({ skipped: "forbidden" });
    }
    if (conversation.title) {
      // Someone named it by hand first; theirs wins.
      return ok({ skipped: "titled" });
    }
    const model = await titleModel({
      context: toChatContext({
        id: conversation.contextId,
        type: conversation.contextType,
      } as Parameters<typeof toChatContext>[0]),
      conversationId,
      signal,
      userId,
    });
    const messages = branch.messages.flatMap((row) => {
      const message = toMessage(row);
      return message.ok ? [message.value] : [];
    });
    const generated = model
      ? await generateTitle(messages, model, { signal })
      : null;
    if (
      generated &&
      !generated.ok &&
      generated.error.retryable &&
      job.retryCount < TITLE_RETRIES
    ) {
      return err(generated.error.message);
    }
    // No model (none configured, or no key in this context), one that
    // can't title, or one still failing on the last try: the first message
    // still beats "New chat".
    const title = generated?.ok ? generated.value : fallbackTitle(messages);
    if (!title) {
      return ok({ skipped: model ? "no_title" : "no_model" });
    }
    await updateConversation(db, conversationId, { title });
    return ok({ title });
  },
});
