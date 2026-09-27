import type { AsyncResult } from "@workspace/shared/result";
import { z } from "zod";

import type { ShortcutOverrides } from "../overrides";

// Where a user's recorded shortcuts live. The web app uses the user-settings
// adapter (`UserSettings.shortcuts`, `overrides-store.settings.ts`, 042) over
// the browser-storage one, which keeps what the server doesn't have yet.

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
