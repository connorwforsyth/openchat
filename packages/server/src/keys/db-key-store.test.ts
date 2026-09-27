import { randomBytes } from "node:crypto";

import { createMemoryProviderRegistry } from "@workspace/ai/ports/provider-registry.memory";
import { appConfigSchema } from "@workspace/config/schema";
import type { Db } from "@workspace/db/client";
import { createProviderKey } from "@workspace/db/queries/provider-keys";
import { orgSettings } from "@workspace/db/schema/tenancy";
import {
  createTestDb,
  expectOk,
  seedOrg,
  seedTeam,
  seedUser,
  type TestDb,
} from "@workspace/db/testing";
import { keyRingOf, seal } from "@workspace/mcp/crypto";
import { ok } from "@workspace/shared/result";
import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createDbKeyStore,
  createKeyStore,
  orgKeyPolicy,
  providerKeyAad,
  type SkippedKey,
} from "./db-key-store";
import { createRegistryVerifier } from "./verify";

// The database KeyStore: stored keys opened on the way out, foreign and
// unopenable ones left behind, instance keys from config on top.

let t: TestDb;
let db: Db;
let creator: Awaited<ReturnType<typeof seedUser>>;

beforeAll(async () => {
  t = await createTestDb();
  ({ db } = t);
  creator = await seedUser(db);
});

afterAll(() => t.close());

const ring = keyRingOf(randomBytes(32));
const otherRing = keyRingOf(randomBytes(32));

type Scope = Parameters<typeof providerKeyAad>[0];

const store = (scope: Scope, apiKey: string, keys = ring) => {
  const sealed = seal(keys, apiKey, providerKeyAad(scope));
  return createProviderKey(db, {
    createdBy: creator.id,
    encryptedKey: sealed.ciphertext,
    hint: apiKey.slice(-4),
    keyId: sealed.keyId,
    provider: "anthropic",
    scope,
  });
};

describe("createDbKeyStore", () => {
  it("opens keys held by the given scopes and skips everything else", async () => {
    const alice = await seedUser(db);
    const bob = await seedUser(db);
    const org = await seedOrg(db, alice.id);
    const team = await seedTeam(db, org.id);
    await store({ id: alice.id, type: "user" }, "sk-alice-000001");
    await store({ id: team.id, type: "team" }, "sk-team-0000002");
    await store({ id: bob.id, type: "user" }, "sk-bob-00000003");
    const lost = await store(
      { id: alice.id, type: "user" },
      "sk-lost-0000004",
      otherRing
    );

    const skipped: SkippedKey[] = [];
    const keys = expectOk(
      await createDbKeyStore(db, ok(ring), {
        report: (each) => skipped.push(each),
      }).keysFor([
        { id: alice.id, type: "user" },
        { id: team.id, type: "team" },
        { type: "instance" },
      ])
    );
    expect(keys).toEqual(
      expect.arrayContaining([
        {
          apiKey: "sk-alice-000001",
          provider: "anthropic",
          source: { id: alice.id, type: "user" },
        },
        {
          apiKey: "sk-team-0000002",
          provider: "anthropic",
          source: { id: team.id, type: "team" },
        },
      ])
    );
    expect(keys).toHaveLength(2);
    expect(skipped).toEqual([{ keyId: lost.id, reason: "unknown_key_id" }]);
    expect(JSON.stringify(skipped)).not.toContain("sk-lost");
  });

  it("won't open a sealed key copied into another scope's row", async () => {
    const alice = await seedUser(db);
    const mallory = await seedUser(db);
    const sealed = seal(
      ring,
      "sk-alice-secret-5",
      providerKeyAad({ id: alice.id, type: "user" })
    );
    await createProviderKey(db, {
      createdBy: mallory.id,
      encryptedKey: sealed.ciphertext,
      hint: "et-5",
      keyId: sealed.keyId,
      provider: "anthropic",
      scope: { id: mallory.id, type: "user" },
    });
    const skipped: SkippedKey[] = [];
    const keys = expectOk(
      await createDbKeyStore(db, ok(ring), {
        report: (each) => skipped.push(each),
      }).keysFor([{ id: mallory.id, type: "user" }])
    );
    expect(keys).toEqual([]);
    expect(skipped).toMatchObject([{ reason: "decrypt_failed" }]);
  });

  it("adds instance keys from config only when the instance scope is asked for", async () => {
    const alice = await seedUser(db);
    await store({ id: alice.id, type: "user" }, "sk-alice-000006");
    const config = appConfigSchema.parse({
      providers: { anthropic: { apiKey: "sk-instance-07" } },
    });
    const keyStore = createKeyStore({ config, db, keys: ok(ring) });
    const userOnly = expectOk(
      await keyStore.keysFor([{ id: alice.id, type: "user" }])
    );
    expect(userOnly.map((key) => key.apiKey)).toEqual(["sk-alice-000006"]);
    const withInstance = expectOk(
      await keyStore.keysFor([
        { id: alice.id, type: "user" },
        { type: "instance" },
      ])
    );
    expect(withInstance.map((key) => key.source.type).sort()).toEqual([
      "instance",
      "user",
    ]);
  });
});

describe("orgKeyPolicy", () => {
  it("clamps the org's stored choice to the instance limits", async () => {
    const owner = await seedUser(db);
    const org = await seedOrg(db, owner.id);
    const plain = await seedOrg(db, owner.id);
    await db
      .insert(orgSettings)
      .values({ orgId: org.id, personalKeyFallback: true });
    const allowed = appConfigSchema.parse({});
    const forbidden = appConfigSchema.parse({
      policies: { personalKeyFallback: "forbidden" },
    });
    expect(await orgKeyPolicy(db, allowed)(org.id)).toEqual({
      personalKeyFallback: true,
    });
    expect(await orgKeyPolicy(db, forbidden)(org.id)).toEqual({
      personalKeyFallback: false,
    });
    expect(await orgKeyPolicy(db, allowed)(plain.id)).toEqual({
      personalKeyFallback: false,
    });
  });
});

describe("createRegistryVerifier", () => {
  const credentials = {
    apiKey: "sk-check-me-0008",
    provider: "anthropic",
    source: { type: "instance" as const },
  };
  const verifierFor = (model: MockLanguageModelV4) =>
    createRegistryVerifier(
      createMemoryProviderRegistry({
        languageModels: { "anthropic:claude-test": model },
      })
    );

  it("makes one tiny call and reports success", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: {
        content: [{ text: "Hi", type: "text" }],
        finishReason: { raw: "stop", unified: "stop" },
        usage: {
          inputTokens: {
            cacheRead: undefined,
            cacheWrite: undefined,
            noCache: 1,
            total: 1,
          },
          outputTokens: { reasoning: undefined, text: 1, total: 1 },
        },
        warnings: [],
      },
    });
    expect(await verifierFor(model)(credentials)).toEqual({
      message: null,
      ok: true,
    });
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(model.doGenerateCalls[0]?.maxOutputTokens).toBe(1);
  });

  it("turns a provider's refusal into a message of our own", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: () => {
        throw new APICallError({
          message: "Invalid API key sk-check-me-0008",
          requestBodyValues: {},
          statusCode: 401,
          url: "https://provider.example.test",
        });
      },
    });
    const result = await verifierFor(model)(credentials);
    expect(result).toEqual({
      message: "The provider rejected this key.",
      ok: false,
    });
  });

  it("says so when no model is configured for the provider", async () => {
    const result = await verifierFor(new MockLanguageModelV4())({
      ...credentials,
      provider: "openai",
    });
    expect(result.ok).toBe(false);
  });
});
