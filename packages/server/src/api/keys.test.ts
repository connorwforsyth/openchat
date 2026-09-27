import { randomBytes } from "node:crypto";

import { call } from "@orpc/server";
import type { ProviderCredentials } from "@workspace/ai/ports/provider-registry";
import { createMemoryProviderRegistry } from "@workspace/ai/ports/provider-registry.memory";
import { appConfigSchema } from "@workspace/config/schema";
import type { UserId } from "@workspace/contract/schemas/common";
import type { writableKeyScopeSchema } from "@workspace/contract/schemas/keys";
import type { Db } from "@workspace/db/client";
import { member } from "@workspace/db/schema/auth";
import { teamMember } from "@workspace/db/schema/tenancy";
import { providerKey } from "@workspace/db/schema/usage";
import {
  createTestDb,
  seedOrg,
  seedTeam,
  seedUser,
  type TestDb,
} from "@workspace/db/testing";
import { keyRingOf } from "@workspace/mcp/crypto";
import { err, ok } from "@workspace/shared/result";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { z } from "zod";

import { configKeyId, createKeysRouter, type KeysDeps } from "./keys";

// Provider keys through the `keys` procedures, called in-process. The live
// check is a fake: nothing here reaches a provider.

const PLAINTEXT = "sk-ant-test-0123456789-WXYZ";
const INSTANCE_KEY = "sk-instance-secret-9876";

let t: TestDb;
let db: Db;

beforeAll(async () => {
  t = await createTestDb();
  ({ db } = t);
});

afterAll(() => t.close());

const config = appConfigSchema.parse({
  providers: {
    anthropic: { apiKey: INSTANCE_KEY, models: ["claude-test"] },
    openai: { models: ["gpt-test"] },
  },
});

const as = (userId: UserId | null) => ({
  context: {
    request: new Request("http://x"),
    session: userId ? { userId } : null,
  },
});

const setup = (overrides: Partial<KeysDeps> = {}) => {
  const verified: ProviderCredentials[] = [];
  const router = createKeysRouter({
    config,
    db,
    keys: ok(keyRingOf(randomBytes(32))),
    registry: createMemoryProviderRegistry({ languageModels: {} }),
    verifyKey: (credentials) => {
      verified.push(credentials);
      return Promise.resolve({ message: null, ok: true });
    },
    ...overrides,
  });
  return { keys: router.keys, verified };
};

/** An org with an owner, an org admin, a plain member, and a team with its own admin. */
const seedTenancy = async () => {
  const owner = await seedUser(db);
  const orgAdmin = await seedUser(db);
  const plain = await seedUser(db);
  const teamAdmin = await seedUser(db);
  const org = await seedOrg(db, owner.id);
  await db.insert(member).values([
    { organizationId: org.id, role: "admin", userId: orgAdmin.id },
    { organizationId: org.id, role: "member", userId: plain.id },
    { organizationId: org.id, role: "member", userId: teamAdmin.id },
  ]);
  const parent = await seedTeam(db, org.id);
  const child = await seedTeam(db, org.id, parent.id);
  await db.insert(teamMember).values([
    { role: "admin", teamId: parent.id, userId: teamAdmin.id },
    { role: "member", teamId: parent.id, userId: plain.id },
  ]);
  return { child, org, orgAdmin, owner, parent, plain, teamAdmin };
};

describe("keys procedures", () => {
  it("needs a session", async () => {
    const { keys } = setup();
    await expect(call(keys.list, {}, as(null))).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(
      call(
        keys.create,
        {
          apiKey: PLAINTEXT,
          provider: "anthropic",
          scope: { id: (await seedUser(db)).id, type: "user" },
        },
        as(null)
      )
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("stores a user's key sealed and never returns it", async () => {
    const { keys } = setup();
    const alice = await seedUser(db);
    const created = await call(
      keys.create,
      {
        apiKey: `${PLAINTEXT}\n`,
        label: "Mine",
        provider: "anthropic",
        scope: { id: alice.id, type: "user" },
      },
      as(alice.id)
    );
    expect(created).toMatchObject({
      createdBy: alice.id,
      hint: "WXYZ",
      label: "Mine",
      provider: "anthropic",
      scope: { id: alice.id, type: "user" },
      source: "database",
    });
    expect(JSON.stringify(created)).not.toContain(PLAINTEXT);

    const [row] = await db
      .select()
      .from(providerKey)
      .where(eq(providerKey.id, created.id));
    expect(row?.encryptedKey).toBeDefined();
    expect(row?.encryptedKey).not.toContain(PLAINTEXT);
    expect(row?.encryptedKey).not.toContain(PLAINTEXT.slice(0, 12));

    const listed = await call(keys.list, {}, as(alice.id));
    expect(listed.map((key) => key.id)).toEqual([created.id]);
    expect(JSON.stringify(listed)).not.toContain(PLAINTEXT);
  });

  it("refuses keys for someone else, and providers the instance lacks", async () => {
    const { keys } = setup();
    const alice = await seedUser(db);
    const bob = await seedUser(db);
    await expect(
      call(
        keys.create,
        {
          apiKey: PLAINTEXT,
          provider: "anthropic",
          scope: { id: bob.id, type: "user" },
        },
        as(alice.id)
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      call(
        keys.create,
        {
          apiKey: PLAINTEXT,
          provider: "mistral",
          scope: { id: alice.id, type: "user" },
        },
        as(alice.id)
      )
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      call(keys.list, { scopeId: bob.id, scopeType: "user" }, as(alice.id))
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("lets team admins manage their subtree and org admins the org", async () => {
    const { keys } = setup();
    const { child, org, orgAdmin, owner, parent, plain, teamAdmin } =
      await seedTenancy();
    const create = (userId: UserId, scope: KeysScope) =>
      call(
        keys.create,
        { apiKey: PLAINTEXT, provider: "anthropic", scope },
        as(userId)
      );

    const teamKey = await create(teamAdmin.id, { id: parent.id, type: "team" });
    const childKey = await create(teamAdmin.id, { id: child.id, type: "team" });
    const orgKey = await create(orgAdmin.id, { id: org.id, type: "org" });
    await expect(
      create(teamAdmin.id, { id: org.id, type: "org" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      create(plain.id, { id: parent.id, type: "team" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const ids = (list: { id: string }[]) => list.map((key) => key.id).sort();
    expect(ids(await call(keys.list, {}, as(teamAdmin.id)))).toEqual(
      [teamKey.id, childKey.id].sort()
    );
    expect(ids(await call(keys.list, {}, as(owner.id)))).toEqual(
      [teamKey.id, childKey.id, orgKey.id].sort()
    );
    expect(await call(keys.list, {}, as(plain.id))).toEqual([]);
    await expect(
      call(keys.list, { scopeId: parent.id, scopeType: "team" }, as(plain.id))
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(
      ids(
        await call(
          keys.list,
          { scopeId: org.id, scopeType: "org" },
          as(orgAdmin.id)
        )
      )
    ).toEqual([orgKey.id]);

    // A key the caller can't manage looks like no key at all.
    await expect(
      call(keys.delete, { id: orgKey.id }, as(teamAdmin.id))
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await call(keys.delete, { id: childKey.id }, as(teamAdmin.id));
    expect(ids(await call(keys.list, {}, as(teamAdmin.id)))).toEqual([
      teamKey.id,
    ]);
  });

  it("shows instance keys to instance admins only, hint and all", async () => {
    const { keys } = setup();
    const admin = await seedUser(db, { role: "user,admin" });
    const user = await seedUser(db);
    const instance = await call(
      keys.list,
      { scopeType: "instance" },
      as(admin.id)
    );
    expect(instance).toEqual([
      expect.objectContaining({
        createdBy: null,
        hint: INSTANCE_KEY.slice(-4),
        id: configKeyId("anthropic"),
        provider: "anthropic",
        scope: { type: "instance" },
        source: "config",
      }),
    ]);
    expect(JSON.stringify(instance)).not.toContain(INSTANCE_KEY);
    expect(await call(keys.list, {}, as(admin.id))).toHaveLength(1);
    expect(await call(keys.list, {}, as(user.id))).toEqual([]);
    await expect(
      call(keys.list, { scopeType: "instance" }, as(user.id))
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      call(keys.delete, { id: configKeyId("anthropic") }, as(admin.id))
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      call(keys.verify, { id: configKeyId("anthropic") }, as(user.id))
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("verifies with the decrypted key, only for keys the caller manages", async () => {
    const { keys, verified } = setup();
    const alice = await seedUser(db);
    const bob = await seedUser(db);
    const admin = await seedUser(db, { role: "admin" });
    const created = await call(
      keys.create,
      {
        apiKey: PLAINTEXT,
        baseURL: "https://proxy.example.test/v1",
        provider: "anthropic",
        scope: { id: alice.id, type: "user" },
      },
      as(alice.id)
    );
    expect(await call(keys.verify, { id: created.id }, as(alice.id))).toEqual({
      message: null,
      ok: true,
    });
    expect(verified).toEqual([
      {
        apiKey: PLAINTEXT,
        baseURL: "https://proxy.example.test/v1",
        provider: "anthropic",
        source: { id: alice.id, type: "user" },
      },
    ]);
    await expect(
      call(keys.verify, { id: created.id }, as(bob.id))
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await call(keys.verify, { id: configKeyId("anthropic") }, as(admin.id));
    expect(verified.at(-1)).toMatchObject({
      apiKey: INSTANCE_KEY,
      source: { type: "instance" },
    });
  });

  it("reports a key sealed under a lost encryption key as unverifiable", async () => {
    const alice = await seedUser(db);
    const before = setup();
    const created = await call(
      before.keys.create,
      {
        apiKey: PLAINTEXT,
        provider: "anthropic",
        scope: { id: alice.id, type: "user" },
      },
      as(alice.id)
    );
    const after = setup();
    const result = await call(
      after.keys.verify,
      { id: created.id },
      as(alice.id)
    );
    expect(result.ok).toBe(false);
    expect(result.message).not.toContain(PLAINTEXT);
    expect(after.verified).toEqual([]);
  });

  it("won't store keys without an encryption key", async () => {
    const { keys } = setup({
      keys: err({ message: "unset", type: "missing_key" }),
    });
    const alice = await seedUser(db);
    await expect(
      call(
        keys.create,
        {
          apiKey: PLAINTEXT,
          provider: "anthropic",
          scope: { id: alice.id, type: "user" },
        },
        as(alice.id)
      )
    ).rejects.toMatchObject({
      code: "ENCRYPTION_UNAVAILABLE",
      defined: true,
      status: 503,
    });
    expect(
      await db
        .select()
        .from(providerKey)
        .where(eq(providerKey.scopeId, alice.id))
    ).toEqual([]);
  });
});

type KeysScope = z.infer<typeof writableKeyScopeSchema>;
