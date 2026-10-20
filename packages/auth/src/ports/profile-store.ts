import { z } from "zod";

// The profile a sign-in would update (186). Better Auth matches the user by
// the provider account first and by email second; `find` follows the same
// order, so the sign-in decides against the row it will write.
//
// `syncedName` and `syncedImage` are what the last sign-in copied from the
// provider. A field that still equals its synced value hasn't been edited
// by the person, so the next sign-in may replace it.

export const storedProfileSchema = z.object({
  image: z.string().nullable(),
  name: z.string(),
  syncedImage: z.string().nullable(),
  syncedName: z.string().nullable(),
});
export type StoredProfile = z.infer<typeof storedProfileSchema>;

export const profileLookupSchema = z.object({
  accountId: z.string().min(1),
  email: z.string(),
  providerId: z.string().min(1),
});
export type ProfileLookup = z.infer<typeof profileLookupSchema>;

export interface ProfileStore {
  /** `undefined` when the sign-in would create a new user. */
  readonly find: (lookup: ProfileLookup) => Promise<StoredProfile | undefined>;
}
