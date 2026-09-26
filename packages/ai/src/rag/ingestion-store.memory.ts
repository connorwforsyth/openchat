import type { FileId } from "@workspace/contract/schemas/common";
import type { ModelRef } from "@workspace/contract/schemas/models";
import { err, ok } from "@workspace/shared/result";

import type { IngestedChunk, IngestionFile, IngestionStore } from "./ingest";

// An in-memory IngestionStore for tests, with the same state rules as the
// database: `replaceChunks` marks the file ready and records the model only
// when something was embedded.

export interface MemoryFileState {
  readonly chunks: readonly IngestedChunk[];
  readonly embeddingModel: ModelRef | null;
  readonly file: IngestionFile;
  readonly message: string | null;
  readonly state: "uploaded" | "processing" | "ready" | "failed";
}

export interface MemoryIngestionStore extends IngestionStore {
  readonly add: (file: IngestionFile) => void;
  readonly remove: (id: FileId) => void;
  readonly state: (id: FileId) => MemoryFileState | undefined;
  /** Every state a file passed through, in order. */
  readonly transitions: (id: FileId) => readonly string[];
}

export const createMemoryIngestionStore = (
  files: readonly IngestionFile[] = []
): MemoryIngestionStore => {
  const rows = new Map<FileId, MemoryFileState>();
  const history = new Map<FileId, string[]>();

  const set = (id: FileId, next: MemoryFileState) => {
    rows.set(id, next);
    history.set(id, [...(history.get(id) ?? []), next.state]);
  };
  const add = (file: IngestionFile) =>
    set(file.id, {
      chunks: [],
      embeddingModel: null,
      file,
      message: null,
      state: "uploaded",
    });
  for (const file of files) {
    add(file);
  }
  const missing = { type: "not_found" as const };

  return {
    add,
    getFile: (id) => {
      const row = rows.get(id);
      return Promise.resolve(row ? ok(row.file) : err(missing));
    },
    listFilesToReindex: (model, { after, limit }) =>
      Promise.resolve(
        [...rows.values()]
          .filter(
            (row) =>
              row.state === "ready" &&
              row.embeddingModel !== model &&
              (after === null || row.file.id > after)
          )
          .map((row) => row.file.id)
          .sort()
          .slice(0, limit)
      ),
    remove: (id) => {
      rows.delete(id);
    },
    replaceChunks: (id, chunks, model) => {
      const row = rows.get(id);
      if (!row) {
        return Promise.resolve(err(missing));
      }
      const embedded = chunks.some((chunk) => chunk.embedding !== null);
      set(id, {
        ...row,
        chunks,
        embeddingModel: embedded ? model : null,
        message: null,
        state: "ready",
      });
      return Promise.resolve(ok(undefined));
    },
    setState: (id, state, message) => {
      const row = rows.get(id);
      if (!row) {
        return Promise.resolve(err(missing));
      }
      set(id, {
        ...row,
        message: state === "failed" ? (message ?? null) : null,
        state,
      });
      return Promise.resolve(ok(undefined));
    },
    state: (id) => rows.get(id),
    transitions: (id) => history.get(id) ?? [],
  };
};
