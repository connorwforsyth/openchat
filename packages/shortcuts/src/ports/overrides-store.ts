import type { AsyncResult } from "@workspace/shared/result";
import { z } from "zod";

import type { ShortcutOverrides } from "../overrides";

// Where a user's recorded shortcuts live. The contract's user settings
// (`GET/PATCH /me/settings`) have no field for them yet, so the web app uses
// the browser-storage adapter keyed by user id; once the contract grows a
// `shortcuts` setting, an adapter over `me.updateSettings` replaces it and no
// caller changes.

export const overridesStoreErrorSchema = z.discriminatedUnion("type", [
  /** Storage is off (private mode, quota) or the server said no. Shortcuts still work with defaults. */
  z.object({ message: z.string(), type: z.literal("unavailable") }),
]);
export type OverridesStoreError = z.infer<typeof overridesStoreErrorSchema>;

export interface OverridesStore {
  /** The saved overrides; `{}` when nothing is saved. Bad entries are dropped. */
  load: () => AsyncResult<ShortcutOverrides, OverridesStoreError>;
  save: (
    overrides: ShortcutOverrides
  ) => AsyncResult<ShortcutOverrides, OverridesStoreError>;
}
