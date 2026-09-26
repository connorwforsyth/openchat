import type {
  MemoryVersionId,
  UserId,
} from "@workspace/contract/schemas/common";
import type { MemoryMode } from "@workspace/contract/schemas/memory";
import { newId } from "@workspace/shared/ids";
import { err, ok } from "@workspace/shared/result";

import type { MemorySnapshot, MemorySource, MemoryStore } from "./store";

// An in-memory `MemoryStore` for tests, with the same compare-and-set rule
// as the database one.

export interface StoredVersion {
  readonly content: string;
  readonly id: MemoryVersionId;
  readonly number: number;
  readonly source: MemorySource;
}

export interface FakeMemoryStore extends MemoryStore {
  readonly setMode: (userId: UserId, mode: MemoryMode) => void;
  readonly versions: (userId: UserId) => readonly StoredVersion[];
}

export const createMemoryStore = (): FakeMemoryStore => {
  const files = new Map<UserId, MemorySnapshot>();
  const history = new Map<UserId, StoredVersion[]>();
  const empty: MemorySnapshot = { content: "", mode: "auto", versionId: null };

  return {
    read: (userId) => Promise.resolve(files.get(userId) ?? empty),
    setMode: (userId, mode) => {
      files.set(userId, { ...(files.get(userId) ?? empty), mode });
    },
    versions: (userId) => history.get(userId) ?? [],
    write: ({ baseVersionId, content, source, userId }) => {
      const current = files.get(userId) ?? empty;
      if (current.versionId !== baseVersionId) {
        return Promise.resolve(err({ type: "version_mismatch" as const }));
      }
      const versions = history.get(userId) ?? [];
      const version: StoredVersion = {
        content,
        id: newId("memoryVersion"),
        number: versions.length + 1,
        source,
      };
      history.set(userId, [...versions, version]);
      files.set(userId, { ...current, content, versionId: version.id });
      return Promise.resolve(
        ok({ number: version.number, versionId: version.id })
      );
    },
  };
};
