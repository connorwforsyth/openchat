import { account, user } from "@workspace/db/schema/auth";
import { createTestDb, type TestDb } from "@workspace/db/testing";
import { afterEach, describe, expect, it } from "vitest";

import { profileStoreFor } from "./store";

let testDb: TestDb | undefined;
afterEach(async () => {
  await testDb?.close();
  testDb = undefined;
});

describe("profileStoreFor", () => {
  it("matches the linked account first, then the email, as Better Auth does", async () => {
    testDb = await createTestDb();
    const { db } = testDb;
    const [linked] = await db
      .insert(user)
      .values([
        { email: "ada@contoso.com", name: "Ada", syncedName: "Ada" },
        { email: "grace@contoso.com", image: "mine.png", name: "Grace" },
      ])
      .returning({ id: user.id });
    if (!linked) {
      throw new Error("no user inserted");
    }
    await db.insert(account).values({
      accountId: "oid-ada",
      providerId: "microsoft",
      userId: linked.id,
    });
    const profiles = profileStoreFor(db);

    expect(
      await profiles.find({
        accountId: "oid-ada",
        email: "grace@contoso.com",
        providerId: "microsoft",
      })
    ).toEqual({
      image: null,
      name: "Ada",
      syncedImage: null,
      syncedName: "Ada",
    });
    expect(
      await profiles.find({
        accountId: "oid-grace",
        email: "Grace@Contoso.com",
        providerId: "microsoft",
      })
    ).toEqual({
      image: "mine.png",
      name: "Grace",
      syncedImage: null,
      syncedName: null,
    });
    expect(
      await profiles.find({
        accountId: "oid-new",
        email: "new@contoso.com",
        providerId: "microsoft",
      })
    ).toBeUndefined();
  });
});
