import type {
  ProfileLookup,
  ProfileStore,
  StoredProfile,
} from "./profile-store";

// An in-memory ProfileStore for tests: profiles keyed by provider account,
// with an email fallback, as the database lookup does.

export interface MemoryProfile extends StoredProfile {
  readonly accounts: readonly Pick<ProfileLookup, "accountId" | "providerId">[];
  readonly email: string;
}

const storedOf = ({
  image,
  name,
  syncedImage,
  syncedName,
}: MemoryProfile): StoredProfile => ({ image, name, syncedImage, syncedName });

export const createMemoryProfileStore = (
  profiles: readonly MemoryProfile[]
): ProfileStore => ({
  find: ({ accountId, email, providerId }) => {
    const found =
      profiles.find((profile) =>
        profile.accounts.some(
          (account) =>
            account.providerId === providerId && account.accountId === accountId
        )
      ) ??
      profiles.find(
        (profile) => profile.email.toLowerCase() === email.toLowerCase()
      );
    return Promise.resolve(found ? storedOf(found) : undefined);
  },
});
