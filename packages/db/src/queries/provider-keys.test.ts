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
    const orgScope = { id: org.id, type: "org" } as const;
    const teamScope = { id: team.id, type: "team" } as const;
    const userScope = { id: user.id, type: "user" } as const;
    const orgKey = await add(orgScope);
    const teamKey = await add(teamScope, "k0");
    const userKey = await add(userScope);
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

    expect(expectOk(await getSealedKey(db, teamScope, teamKey.id))).toEqual({
      encryptedKey: "sealed-team",
      keyId: "k0",
    });
    const stale = await listKeysToReseal(db, "k1");
    expect(stale.map((k) => k.id)).toContain(teamKey.id);
    expect(stale.map((k) => k.id)).not.toContain(orgKey.id);
    expectOk(
      await resealProviderKey(db, teamScope, teamKey.id, {
        encryptedKey: "resealed",
        keyId: "k1",
      })
    );
    expect(expectOk(await getSealedKey(db, teamScope, teamKey.id)).keyId).toBe(
      "k1"
    );

    await touchProviderKey(
      db,
      userScope,
      userKey.id,
      new Date("2026-09-27T00:00:00Z")
    );
    const [touched] = await listProviderKeys(db, { id: user.id, type: "user" });
    const mapped = touched && toProviderKey(touched);
    expect(mapped && providerKeySchema.parse(mapped)).toMatchObject({
      lastUsedAt: "2026-09-27T00:00:00.000Z",
      scope: { id: user.id, type: "user" },
      source: "database",
    });

    expectOk(await deleteProviderKey(db, orgScope, orgKey.id));
    expect(await deleteProviderKey(db, orgScope, orgKey.id)).toMatchObject({
      error: { type: "not_found" },
    });
    expect(
      await getSealedKey(db, orgScope, newId("providerKey"))
    ).toMatchObject({
      error: { type: "not_found" },
    });
  });

  test("an id only reaches its key within the scope that owns it", async () => {
    const { db } = testDb;
    const owner = await seedUser(db);
    const other = await seedUser(db);
    const org = await seedOrg(db, owner.id);
    const ownerScope = { id: owner.id, type: "user" } as const;
    const otherScope = { id: other.id, type: "user" } as const;
    const orgScope = { id: org.id, type: "org" } as const;
    const key = await createProviderKey(db, {
      createdBy: owner.id,
      encryptedKey: "sealed-owner",
      hint: "wxyz",
      keyId: "k1",
      provider: "anthropic",
      scope: ownerScope,
    });

    // Someone else's scope, or an org the owner is in, is not the key's.
    for (const scope of [otherScope, orgScope]) {
      // biome-ignore lint/performance/noAwaitInLoops: two scopes, checked in turn.
      expect(await getSealedKey(db, scope, key.id)).toMatchObject({
        error: { type: "not_found" },
      });
      expect(
        await resealProviderKey(db, scope, key.id, {
          encryptedKey: "stolen",
          keyId: "k2",
        })
      ).toMatchObject({ error: { type: "not_found" } });
      await touchProviderKey(db, scope, key.id, new Date());
      expect(await deleteProviderKey(db, scope, key.id)).toMatchObject({
        error: { type: "not_found" },
      });
    }
    expect(await listProviderKeys(db, otherScope)).toEqual([]);

    // Untouched: still sealed as it was, never used, and there to delete.
    expect(expectOk(await getSealedKey(db, ownerScope, key.id))).toEqual({
      encryptedKey: "sealed-owner",
      keyId: "k1",
    });
    const [kept] = await listProviderKeys(db, ownerScope);
    expect(kept?.lastUsedAt).toBeNull();
    expectOk(await deleteProviderKey(db, ownerScope, key.id));
  });
});
