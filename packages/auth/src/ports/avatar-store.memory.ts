import { ok } from "@workspace/shared/result";

import type { AvatarStore } from "./avatar-store";

// An in-memory AvatarStore for tests. URLs are `memory://avatars/<key>`.

export interface StoredAvatar {
  readonly bytes: Uint8Array;
  readonly contentType: string;
}

export interface MemoryAvatarStore extends AvatarStore {
  readonly avatars: ReadonlyMap<string, StoredAvatar>;
}

export const memoryAvatarUrl = (key: string): string =>
  `memory://avatars/${key}`;

export const createMemoryAvatarStore = (): MemoryAvatarStore => {
  const avatars = new Map<string, StoredAvatar>();
  return {
    avatars,
    find: (key) =>
      Promise.resolve(avatars.has(key) ? memoryAvatarUrl(key) : undefined),
    put: (key, bytes, contentType) => {
      avatars.set(key, { bytes, contentType });
      return Promise.resolve(ok(memoryAvatarUrl(key)));
    },
  };
};
