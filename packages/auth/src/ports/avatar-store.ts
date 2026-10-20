import type { AsyncResult } from "@workspace/shared/result";

// Where profile photos copied from a sign-in provider live (186). The server
// backs it with the Storage port and serves each avatar at a URL it owns.
// Keys are chosen by the auth package and change whenever the photo does.

export interface AvatarStore {
  /** The URL of a stored avatar, or `undefined` when there isn't one. */
  readonly find: (key: string) => Promise<string | undefined>;
  /** Stores the bytes and returns their URL. */
  readonly put: (
    key: string,
    bytes: Uint8Array,
    contentType: string
  ) => AsyncResult<string, string>;
}
