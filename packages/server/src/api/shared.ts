import type { SharedResourceLoader } from "@workspace/auth/handlers/context";
import type { ConversationId } from "@workspace/contract/schemas/common";
import type { BranchPath } from "@workspace/contract/schemas/messages";
import type { Db } from "@workspace/db/client";
import { getConversationWithBranch } from "@workspace/db/queries/conversations";
import { conversation } from "@workspace/db/schema/chat";
import { eq } from "drizzle-orm";

import { actorFor } from "../context";
import { loadSharedLibraryItem } from "../library/router";
import { toMessages } from "./mappers";

// What a public share link shows (`shareLinks.resolve`, 012): a library
// item's export (017), or a chat's branch as its owner sees it. The link
// row itself was the access check; this only reads.

const loadSharedConversation = async (
  db: Db,
  id: ConversationId
): Promise<{
  readonly branch: BranchPath;
  readonly title: string | null;
} | null> => {
  const [row] = await db
    .select({ ownerId: conversation.ownerId })
    .from(conversation)
    .where(eq(conversation.id, id));
  if (!row) {
    return null;
  }
  // The owner's view: their active branch is the one they were looking at
  // when they shared it (the link row doesn't record a leaf).
  const owner = await actorFor(db, { userId: row.ownerId });
  const found = await getConversationWithBranch(db, id, owner);
  if (!found.ok) {
    return null;
  }
  const { branch } = found.value;
  return {
    branch: {
      conversationId: id,
      leafId: branch.leafId,
      messages: toMessages(branch.messages),
      siblings: [...branch.siblings],
    },
    title: found.value.conversation.title,
  };
};

export const createSharedResourceLoader =
  (db: Db, now?: () => Date): SharedResourceLoader =>
  async (ref) => {
    if (ref.resourceType !== "conversation") {
      return loadSharedLibraryItem(db, now)(ref);
    }
    const shared = await loadSharedConversation(
      db,
      ref.resourceId as ConversationId
    );
    return shared
      ? {
          branch: shared.branch,
          resourceType: "conversation",
          title: shared.title,
        }
      : null;
  };
