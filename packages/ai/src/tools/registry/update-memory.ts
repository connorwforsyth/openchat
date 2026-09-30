import {
  type ConversationId,
  type MessageId,
  memoryVersionIdSchema,
  type RunId,
  type UserId,
} from "@workspace/contract/schemas/common";
import {
  type UpdateMemoryToolInput,
  updateMemoryToolInputSchema,
} from "@workspace/contract/schemas/memory";
import { z } from "zod";

import { applyMemoryPatches, describePatchError } from "../../memory/patch";
import { UPDATE_MEMORY_TOOL } from "../../memory/prompt";
import type { MemoryStore } from "../../memory/store";
import { defineTool, type ToolActor, type ToolContext } from "./define";

// The agent's `update_memory` server tool (D20). In `auto` mode it applies
// the patches at once as a new `memory_version`; in `propose` mode the run
// asks the user first (the turn marks the tool `user-approval`, and the
// approval card previews the patches with `applyMemoryPatches`), so the edit
// only lands once they approve.
//
// Its result is what the chat UI's "Memory updated · Undo" note reads
// (015): the summary, the new version, and the version to go back to.

export const updateMemoryToolOutputSchema = z.discriminatedUnion("status", [
  z.object({
    number: z.int().min(1),
    /**
     * Undo reverts to this version (`POST /memory/revert`). `null` when this
     * was the first write: undo then clears the file (`PUT /memory` with
     * empty content, based on `versionId`).
     */
    previousVersionId: memoryVersionIdSchema.nullable(),
    status: z.literal("applied"),
    summary: z.string(),
    versionId: memoryVersionIdSchema,
  }),
  z.object({
    message: z.string(),
    reason: z.enum(["not_found", "ambiguous", "too_large", "busy"]),
    status: z.literal("rejected"),
  }),
]);
export type UpdateMemoryToolOutput = z.infer<
  typeof updateMemoryToolOutputSchema
>;

export interface UpdateMemoryToolDeps {
  /** The cap from `limits.memoryMaxChars`; the agent can't grow the file past it. */
  readonly maxChars: number;
  /** Where the edit came from, for the version's history. */
  readonly origin: {
    readonly conversationId: ConversationId;
    readonly messageId: MessageId;
    readonly runId: RunId;
  };
  readonly store: MemoryStore;
  readonly userId: UserId;
}

/** Another edit landing between our read and write is retried on the fresh file this often. */
const WRITE_ATTEMPTS = 3;

/** Applies an `update_memory` call. Exposed for tests; the tool wraps it. */
export const updateMemory = async (
  { maxChars, origin, store, userId }: UpdateMemoryToolDeps,
  input: UpdateMemoryToolInput
): Promise<UpdateMemoryToolOutput> => {
  for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
    // biome-ignore lint/performance/noAwaitInLoops: each retry re-reads what the last one lost to.
    const current = await store.read(userId);
    const next = applyMemoryPatches(current.content, input.patches);
    if (!next.ok) {
      return {
        message: describePatchError(next.error),
        reason: next.error.type,
        status: "rejected",
      };
    }
    // Shrinking an oversized file is always allowed; growing past the cap isn't.
    if (
      next.value.length > maxChars &&
      next.value.length > current.content.length
    ) {
      return {
        message: `The memory file would be ${next.value.length} characters; the limit is ${maxChars}. Consolidate or remove entries instead of adding.`,
        reason: "too_large",
        status: "rejected",
      };
    }
    const written = await store.write({
      baseVersionId: current.versionId,
      content: next.value,
      source: { ...origin, type: "agent" },
      userId,
    });
    if (written.ok) {
      return {
        number: written.value.number,
        previousVersionId: current.versionId,
        status: "applied",
        summary: input.summary,
        versionId: written.value.versionId,
      };
    }
  }
  return {
    message: "The memory file is being changed elsewhere. Try again shortly.",
    reason: "busy",
    status: "rejected",
  };
};

/** Whose memory, from which answer, through which store. */
export interface UpdateMemoryRun {
  readonly actor: ToolActor;
  /** Where the edit came from, for the version's history. */
  readonly conversation: {
    readonly id: ConversationId;
    readonly messageId: MessageId;
    readonly runId: RunId;
  };
  readonly ports: Pick<UpdateMemoryToolDeps, "maxChars" | "store">;
}

export const updateMemoryTool = defineTool({
  // The default memory mode is `auto`, where an edit lands at once (and the
  // chat offers Undo). A user who chose `propose` is asked first: that's
  // their setting, applied by `withMemory`, not this tool's default.
  approval: "auto",
  capability: "memory",
  description:
    'Edit the user\'s memory file (Markdown, shown in your instructions). Each patch appends a line, replaces an exact snippet, or deletes an exact snippet; a snippet must occur exactly once in the file. `summary` is one short line for the user, in their language, such as "Prefers pnpm".',
  execute: (
    input,
    { actor, conversation, ports }: ToolContext<UpdateMemoryRun>
  ) =>
    updateMemory(
      {
        maxChars: ports.maxChars,
        origin: {
          conversationId: conversation.id,
          messageId: conversation.messageId,
          runId: conversation.runId,
        },
        store: ports.store,
        userId: actor.userId,
      },
      input
    ),
  input: updateMemoryToolInputSchema,
  name: UPDATE_MEMORY_TOOL,
  output: updateMemoryToolOutputSchema,
});
