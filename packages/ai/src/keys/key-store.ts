import type { KeyScope } from "@workspace/contract/schemas/keys";
import type { AsyncResult } from "@workspace/shared/result";
import { z } from "zod";

import type { ProviderCredentials } from "../ports/provider-registry";

// Where provider keys come from, as a port so `resolveChatKeys` stays free of
// the database (ticket 011 stores org, team and user keys encrypted; instance
// keys come from app.config.yaml). Keys are decrypted only on the way into a
// provider call and never leave the server.

export const keyStoreErrorSchema = z.object({
  message: z.string(),
  type: z.literal("unavailable"),
});
export type KeyStoreError = z.infer<typeof keyStoreErrorSchema>;

export interface KeyStore {
  /**
   * Every key held directly by one of `scopes` (not by a scope's parents),
   * decrypted, with `source` set to the scope that holds it. Order is free.
   */
  keysFor: (
    scopes: readonly KeyScope[],
    options?: { readonly signal?: AbortSignal }
  ) => AsyncResult<readonly ProviderCredentials[], KeyStoreError>;
}

export const sameScope = (a: KeyScope, b: KeyScope): boolean => {
  if (a.type === "instance" || b.type === "instance") {
    return a.type === b.type;
  }
  return a.type === b.type && a.id === b.id;
};
