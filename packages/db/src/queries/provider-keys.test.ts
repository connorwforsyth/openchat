import { providerKeySchema } from "@workspace/contract/schemas/keys";
import { newId } from "@workspace/shared/ids";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  createTestDb,
  expectOk,
  seedOrg,
  seedTeam,
  seedUser,
  type TestDb,
} from "../testing";
import {
  createProviderKey,
  deleteProviderKey,
  findKeysForScopes,
  getSealedKey,
  listKeysToReseal,
  listProviderKeys,
  resealProviderKey,
  toProviderKey,
  touchProviderKey,
} from "./provider-keys";

let testDb: TestDb;
beforeAll(async () => {
  testDb = await createTestDb();
});
afterAll(() => testDb.close());

describe("provider keys", () => {
  test("stores sealed keys, reads public fields, resolves in scope order", async () => {
    const { db } = testDb;
    const user = await seedUser(db);
    const org = await seedOrg(db, user.id);
    const team = await seedTeam(db, org.id);
    const add = (
      scope: Parameters<typeof createProviderKey>[1]["scope"],
      keyId = "k1"
    ) =>
      createProviderKey(db, {
        createdBy: user.id,
        encryptedKey: `sealed-${scope.type}`,
        hint: "abcd",
        keyId,
        provider: "openai",
        scope,
      });
    const orgKey = await add({ id: org.id, type: "org" });
    const teamKey = await add({ id: team.id, type: "team" }, "k0");
    const userKey = await add({ id: user.id, type: "user" });
    expect(orgKey).not.toHaveProperty("encryptedKey");

    const chain = await findKeysForScopes(db, "openai", [
      { id: team.id, type: "team" },
      { id: org.id, type: "org" },
      { id: user.id, type: "user" },
    ]);
    expect(chain.map((k) => k.id)).toEqual([teamKey.id, orgKey.id, userKey.id]);
    expect(
      await findKeysForScopes(db, "anthropic", [{ id: org.id, type: "org" }])
    ).toEqual([]);
    expect(await findKeysForScopes(db, "openai", [])).toEqual([]);
    expect(
      await listProviderKeys(db, { id: org.id, type: "org" })
    ).toHaveLength(1);

    expect(expectOk(await getSealedKey(db, teamKey.id))).toEqual({
      encryptedKey: "sealed-team",
      keyId: "k0",
    });
    const stale = await listKeysToReseal(db, "k1");
    expect(stale.map((k) => k.id)).toContain(teamKey.id);
    expect(stale.map((k) => k.id)).not.toContain(orgKey.id);
    expectOk(
      await resealProviderKey(db, teamKey.id, {
        encryptedKey: "resealed",
        keyId: "k1",
      })
    );
    expect(expectOk(await getSealedKey(db, teamKey.id)).keyId).toBe("k1");

    await touchProviderKey(db, userKey.id, new Date("2026-09-27T00:00:00Z"));
    const [touched] = await listProviderKeys(db, { id: user.id, type: "user" });
    const mapped = touched && toProviderKey(touched);
    expect(mapped && providerKeySchema.parse(mapped)).toMatchObject({
      lastUsedAt: "2026-09-27T00:00:00.000Z",
      scope: { id: user.id, type: "user" },
      source: "database",
    });

    expectOk(await deleteProviderKey(db, orgKey.id));
    expect(await deleteProviderKey(db, orgKey.id)).toMatchObject({
      error: { type: "not_found" },
    });
    expect(await getSealedKey(db, newId("providerKey"))).toMatchObject({
      error: { type: "not_found" },
    });
  });
});
