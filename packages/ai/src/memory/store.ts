import type {
  MemoryVersionId,
  UserId,
} from "@workspace/contract/schemas/common";
import type {
  MemoryMode,
  memoryVersionSourceSchema,
} from "@workspace/contract/schemas/memory";
import type { AsyncResult } from "@workspace/shared/result";
import type { z } from "zod";

// The memory store port: what the `update_memory` tool needs from storage.
// The server implements it over `@workspace/db` (every write is a
// `memory_version`); `store.memory.ts` is the in-memory fake for tests.

export type MemorySource = z.infer<typeof memoryVersionSourceSchema>;

export interface MemorySnapshot {
  readonly content: string;
  readonly mode: MemoryMode;
  /** `null` before the first write. */
  readonly versionId: MemoryVersionId | null;
}

export interface MemoryWritten {
  readonly number: number;
  readonly versionId: MemoryVersionId;
}

/** Someone changed the file between our read and our write. */
export interface MemoryVersionMismatch {
  readonly type: "version_mismatch";
}

export interface MemoryStore {
  read: (userId: UserId) => Promise<MemorySnapshot>;
  /**
   * Writes a new version if the current one is still `baseVersionId`
   * (`null`: the file was never written), so concurrent edits never lose
   * each other's changes.
   */
  write: (input: {
    readonly baseVersionId: MemoryVersionId | null;
    readonly content: string;
    readonly source: MemorySource;
    readonly userId: UserId;
  }) => AsyncResult<MemoryWritten, MemoryVersionMismatch>;
}
