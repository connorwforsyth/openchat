import type { MemoryStore } from "@workspace/ai/memory/store";
import { createUpdateMemoryTool } from "@workspace/ai/memory/tool";
import { isPrivateChat, withMemory } from "@workspace/ai/memory/turn";
import type { RunStart } from "@workspace/ai/ports/run-executor";
import type { Db } from "@workspace/db/client";
import {
  getConversation,
  listParticipants,
} from "@workspace/db/queries/conversations";
import { getMemory, writeMemory } from "@workspace/db/queries/memory";
import { getRun } from "@workspace/db/queries/runs";
import { err, ok } from "@workspace/shared/result";

import { actorFor } from "../context";
import type { TurnResolver } from "./turn";

// Memory in chat runs (D20, ticket 022): wraps a `TurnResolver` so every
// turn in a private chat gets the user's memory file in its instructions and
// the `update_memory` tool. Shared chats get neither. Memory is an extra:
// if loading it fails, the turn goes ahead without it.

export interface MemorySettings {
  /** `features.memory`. */
  readonly enabled: boolean;
  /** `limits.memoryMaxChars`. */
  readonly maxChars: number;
}

/** The `MemoryStore` port over `@workspace/db`. */
export const dbMemoryStore = (db: Db): MemoryStore => ({
  read: async (userId) => {
    const row = await getMemory(db, userId);
    return {
      content: row.content,
      mode: row.mode,
      versionId: row.currentVersionId,
    };
  },
  write: async ({ baseVersionId, content, source, userId }) => {
    const written = await writeMemory(db, {
      baseVersionId,
      content,
      source,
      userId,
    });
    return written.ok
      ? ok({ number: written.value.number, versionId: written.value.id })
      : err({ type: "version_mismatch" as const });
  },
});

/** Whether only the run's creator can read its chat. */
const inPrivateChat = async (db: Db, run: RunStart): Promise<boolean> => {
  const actor = await actorFor(db, { userId: run.createdBy });
  const chat = await getConversation(db, run.conversationId, actor);
  if (!chat.ok) {
    return false;
  }
  const participants = await listParticipants(db, run.conversationId);
  return isPrivateChat({
    ownerId: chat.value.ownerId,
    participantIds: participants.map((participant) => participant.userId),
    requesterId: run.createdBy,
    visibility: chat.value.visibility,
  });
};

export const withChatMemory = (
  resolveTurn: TurnResolver,
  deps: {
    readonly db: Db;
    readonly report?: (message: string, cause: unknown) => void;
    readonly settings: MemorySettings;
  }
): TurnResolver => {
  const { db, settings } = deps;
  const store = dbMemoryStore(db);
  return async (run, options) => {
    const turn = await resolveTurn(run, options);
    if (!(turn.ok && settings.enabled)) {
      return turn;
    }
    try {
      if (!(await inPrivateChat(db, run))) {
        return turn;
      }
      const [snapshot, row] = await Promise.all([
        store.read(run.createdBy),
        getRun(db, run.runId),
      ]);
      // The run was claimed before its turn resolves, so the answer exists;
      // the version's history points at it for the "Memory updated" note.
      const messageId =
        (row.ok ? row.value.assistantMessageId : null) ?? run.userMessageId;
      const tool = createUpdateMemoryTool({
        maxChars: settings.maxChars,
        origin: {
          conversationId: run.conversationId,
          messageId,
          runId: run.runId,
        },
        store,
        userId: run.createdBy,
      });
      return ok(
        withMemory(turn.value, {
          maxChars: settings.maxChars,
          snapshot,
          tool,
        })
      );
    } catch (cause) {
      deps.report?.("couldn't load memory for a turn", cause);
      return turn;
    }
  };
};
