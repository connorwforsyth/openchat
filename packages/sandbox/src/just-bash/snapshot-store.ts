import type { Storage } from "@workspace/server/ports/storage";
import { type AsyncResult, err, ok } from "@workspace/shared/result";

import type { SandboxError } from "../ports/sandbox";

// Where just-bash workspaces go when they leave memory. The provider hands
// over serialised bytes under a key (the sandbox's live state, or a named
// snapshot); the server backs this with its `Storage` so a chat's scratch
// workspace survives restarts and redeploys.

export interface SnapshotStore {
  /** `null` when nothing was ever saved under `key`. */
  load: (key: string) => AsyncResult<Uint8Array | null, SandboxError>;
  remove: (key: string) => AsyncResult<void, SandboxError>;
  save: (key: string, bytes: Uint8Array) => AsyncResult<void, SandboxError>;
}

/** Keeps everything in this process: for tests, the demo page and a store-less dev boot. */
export const createMemorySnapshotStore = (): SnapshotStore & {
  readonly keys: () => readonly string[];
} => {
  const saved = new Map<string, Uint8Array>();
  return {
    keys: () => [...saved.keys()],
    load: (key) => Promise.resolve(ok(saved.get(key)?.slice() ?? null)),
    remove: (key) => {
      saved.delete(key);
      return Promise.resolve(ok(undefined));
    },
    save: (key, bytes) => {
      saved.set(key, bytes.slice());
      return Promise.resolve(ok(undefined));
    },
  };
};

const readAll = async (body: ReadableStream<Uint8Array>): Promise<Uint8Array> =>
  new Uint8Array(await new Response(body).arrayBuffer());

/** Stores workspaces as objects under `prefix` in the server's `Storage`. */
export const snapshotStoreOnStorage = (
  storage: Storage,
  prefix = "sandboxes"
): SnapshotStore => {
  const keyOf = (key: string) => `${prefix}/${key}.json`;
  const unavailable = (message: string): SandboxError => ({
    message,
    type: "unavailable",
  });
  return {
    load: async (key) => {
      const found = await storage.get(keyOf(key));
      if (!found.ok) {
        return found.error.type === "not_found"
          ? ok(null)
          : err(unavailable("the workspace store is unavailable"));
      }
      return ok(await readAll(found.value.body));
    },
    remove: async (key) => {
      const removed = await storage.delete(keyOf(key));
      return removed.ok
        ? ok(undefined)
        : err(unavailable("the workspace store is unavailable"));
    },
    save: async (key, bytes) => {
      const saved = await storage.put(keyOf(key), bytes, {
        contentType: "application/json",
      });
      return saved.ok
        ? ok(undefined)
        : err(unavailable("the workspace store is unavailable"));
    },
  };
};
