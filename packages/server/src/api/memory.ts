import { implement, ORPCError } from "@orpc/server";
import { contract } from "@workspace/contract/contract";
import type { UserId } from "@workspace/contract/schemas/common";
import type { MemoryDocument } from "@workspace/contract/schemas/memory";
import type { Db } from "@workspace/db/client";
import {
  getMemory,
  listMemoryVersions,
  type MemoryRow,
  revertMemory,
  setMemoryMode,
  toMemoryVersion,
  writeMemory,
} from "@workspace/db/queries/memory";
import { decodeCursor, encodeCursor } from "@workspace/db/queries/page";

import type { RequestContext } from "../context";
import type { MemorySettings } from "../runs/memory";

// The `memory` procedure group (D20, ticket 022): the user's memory file as
// settings shows it, direct edits, the version list, undo (revert) and the
// auto/propose switch. Every write is a new version; nothing is lost.

export const toMemoryDocument = (
  row: MemoryRow,
  maxChars: number
): MemoryDocument => ({
  content: row.content,
  maxChars,
  mode: row.mode,
  updatedAt: row.currentVersionId === null ? null : row.updatedAt.toISOString(),
  versionId: row.currentVersionId,
});

interface FeatureErrors {
  readonly FEATURE_DISABLED: (options: { data: { feature: string } }) => Error;
}

export const createMemoryRouter = (db: Db, settings: MemorySettings) => {
  const os = implement(contract).$context<RequestContext>();
  const authed = os.use(({ context, next }) => {
    if (!context.session) {
      throw new ORPCError("UNAUTHORIZED");
    }
    return next({ context: { userId: context.session.userId } });
  });

  const requireEnabled = (errors: FeatureErrors) => {
    if (!settings.enabled) {
      throw errors.FEATURE_DISABLED({ data: { feature: "memory" } });
    }
  };
  const documentOf = async (userId: UserId) =>
    toMemoryDocument(await getMemory(db, userId), settings.maxChars);

  const memory = {
    get: authed.memory.get.handler(({ context, errors }) => {
      requireEnabled(errors);
      return documentOf(context.userId);
    }),

    revert: authed.memory.revert.handler(async ({ context, errors, input }) => {
      requireEnabled(errors);
      const reverted = await revertMemory(db, context.userId, input.versionId);
      if (!reverted.ok) {
        // A revert takes no base version, so the only failure is a missing one.
        throw new ORPCError("NOT_FOUND");
      }
      return documentOf(context.userId);
    }),

    setMode: authed.memory.setMode.handler(
      async ({ context, errors, input }) => {
        requireEnabled(errors);
        await setMemoryMode(db, context.userId, input.mode);
        return documentOf(context.userId);
      }
    ),

    update: authed.memory.update.handler(async ({ context, errors, input }) => {
      requireEnabled(errors);
      const written = await writeMemory(db, {
        baseVersionId: input.baseVersionId,
        content: input.content,
        source: { type: "user" },
        userId: context.userId,
      });
      if (!written.ok) {
        throw errors.CONFLICT({ data: { reason: "version_mismatch" } });
      }
      return documentOf(context.userId);
    }),

    versions: authed.memory.versions.handler(
      async ({ context, errors, input }) => {
        requireEnabled(errors);
        let before: number | undefined;
        if (input.cursor !== undefined) {
          const cursor = decodeCursor(input.cursor);
          if (!(cursor.ok && typeof cursor.value.key === "number")) {
            throw errors.VALIDATION({
              data: {
                issues: [{ message: "Unknown cursor.", path: ["cursor"] }],
              },
            });
          }
          before = cursor.value.key;
        }
        const rows = await listMemoryVersions(db, context.userId, {
          before,
          limit: input.limit + 1,
        });
        const items = rows.slice(0, input.limit);
        const last = items.at(-1);
        return {
          items: items.map(toMemoryVersion),
          nextCursor:
            rows.length > input.limit && last
              ? encodeCursor({ id: last.id, key: last.number })
              : null,
        };
      }
    ),
  };

  return { memory };
};
