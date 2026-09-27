import type { LibraryItemId, UserId } from "@workspace/contract/schemas/common";
import type { RunTarget } from "@workspace/contract/schemas/runs";
import type { Db } from "@workspace/db/client";
import {
  getVersion,
  type LibraryVersionRow,
} from "@workspace/db/queries/library";
import { type AsyncResult, err, ok } from "@workspace/shared/result";

import { resolveItem } from "../library/core";

// Running an agent's draft (ticket 033). Consumers only ever get published
// versions (D13: drafts until published), but the builder's test chat has
// to answer with what's being edited, so a run may pin the agent's *draft*
// version id (the contract's `versionId`; editors see it as
// `draftVersionId`). Only people who can edit the agent may: to anyone else
// the draft doesn't exist.

export type AgentDraft = LibraryVersionRow<"agent">;

/**
 * The agent's draft, when `target` pins it. `null` for a published pin, no
 * pin, a model, or a version of some other item: those resolve as before.
 */
export const pinnedDraft = async (
  db: Db,
  target: RunTarget | null | undefined
): Promise<AgentDraft | null> => {
  if (target?.type !== "agent" || target.versionId === undefined) {
    return null;
  }
  const found = await getVersion(db, "agent", target.versionId);
  return found.ok &&
    found.value.itemId === target.id &&
    found.value.status === "draft"
    ? found.value
    : null;
};

/** Whether `userId` may edit the agent, which running its draft takes. */
export const canEditAgent = async (
  db: Db,
  userId: UserId,
  id: LibraryItemId
): Promise<boolean> => {
  const resolved = await resolveItem(db, userId, id, "edit");
  return resolved.ok && resolved.value.kind === "agent";
};

/**
 * The draft `target` pins, once the caller is known to be able to edit the
 * agent. `null` when it pins no draft; `not_found` (not `forbidden`) for
 * anyone who can't edit, so a use-only consumer doesn't learn one exists.
 */
export const draftFor = async (
  db: Db,
  userId: UserId,
  target: RunTarget | null | undefined
): AsyncResult<AgentDraft | null, { readonly type: "not_found" }> => {
  const draft = await pinnedDraft(db, target);
  if (!draft) {
    return ok(null);
  }
  return (await canEditAgent(db, userId, draft.itemId))
    ? ok(draft)
    : err({ type: "not_found" });
};
