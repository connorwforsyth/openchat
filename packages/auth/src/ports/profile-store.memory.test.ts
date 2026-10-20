import { describe, expect, it } from "vitest";

import { createMemoryProfileStore } from "./profile-store.memory";

const ada = {
  accounts: [{ accountId: "oid-ada", providerId: "microsoft" }],
  email: "ada@example.com",
  image: null,
  name: "Ada",
  syncedImage: null,
  syncedName: "Ada",
};
const grace = {
  accounts: [],
  email: "grace@example.com",
  image: "https://example.com/grace.png",
  name: "Grace",
  syncedImage: null,
  syncedName: null,
};

describe("createMemoryProfileStore", () => {
  const store = createMemoryProfileStore([ada, grace]);

  it("matches the provider account before the email", async () => {
    expect(
      await store.find({
        accountId: "oid-ada",
        email: "grace@example.com",
        providerId: "microsoft",
      })
    ).toEqual({
      image: null,
      name: "Ada",
      syncedImage: null,
      syncedName: "Ada",
    });
  });

  it("falls back to the email, ignoring case", async () => {
    expect(
      (
        await store.find({
          accountId: "oid-unknown",
          email: "Grace@Example.com",
          providerId: "microsoft",
        })
      )?.name
    ).toBe("Grace");
  });

  it("finds nothing for a new person", async () => {
    expect(
      await store.find({
        accountId: "oid-new",
        email: "new@example.com",
        providerId: "microsoft",
      })
    ).toBeUndefined();
  });
});
