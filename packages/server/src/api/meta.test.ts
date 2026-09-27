import { call } from "@orpc/server";
import { createMemoryKeyStore } from "@workspace/ai/keys/key-store.memory";
import { buildRegistry } from "@workspace/ai/providers/registry";
import { type AppConfigInput, appConfigSchema } from "@workspace/config/schema";
import type { UserId } from "@workspace/contract/schemas/common";
import type { ModelOption } from "@workspace/contract/schemas/models";
import type { Db } from "@workspace/db/client";
import { teamMember } from "@workspace/db/schema/tenancy";
import {
  createTestDb,
  seedOrg,
  seedTeam,
  seedUser,
  type TestDb,
} from "@workspace/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createMetaRouter } from "./meta";

// The public config and the model picker. Availability comes from the same
// key resolution a run uses; keys here are in a memory store, and listing
// models never reaches a provider.

let t: TestDb;
let db: Db;

beforeAll(async () => {
  t = await createTestDb();
  ({ db } = t);
});

afterAll(() => t.close());

const as = (userId: UserId | null) => ({
  context: {
    request: new Request("http://x"),
    session: userId ? { userId } : null,
  },
});

const baseConfig: AppConfigInput = {
  brand: { name: "Test Chat" },
  models: {
    aliases: { fast: "anthropic:claude-test" },
    auto: { cheap: "fast", enabled: true, strong: "openai:gpt-test" },
  },
  providers: {
    anthropic: { models: ["claude-test"] },
    ollama: {
      baseURL: "http://localhost:11434/v1",
      models: ["llama-test"],
      type: "openai-compatible",
    },
    openai: { models: ["gpt-test"] },
  },
};

const seedWorld = async () => {
  const alice = await seedUser(db);
  const outsider = await seedUser(db);
  const org = await seedOrg(db, alice.id);
  const team = await seedTeam(db, org.id);
  await db
    .insert(teamMember)
    .values({ role: "member", teamId: team.id, userId: alice.id });
  return { alice, org, outsider, team };
};

const setup = (
  world: Awaited<ReturnType<typeof seedWorld>>,
  {
    config: overrides = {},
    personalKeyFallback = false,
  }: {
    readonly config?: Partial<AppConfigInput>;
    readonly personalKeyFallback?: boolean;
  } = {}
) => {
  const config = appConfigSchema.parse({ ...baseConfig, ...overrides });
  return createMetaRouter({
    config,
    db,
    env: {},
    keyStore: createMemoryKeyStore([
      {
        apiKey: "sk-alice-anthropic",
        provider: "anthropic",
        source: { id: world.alice.id, type: "user" },
      },
      {
        apiKey: "sk-team-openai",
        provider: "openai",
        source: { id: world.team.id, type: "team" },
      },
    ]),
    orgPolicy: () => Promise.resolve({ personalKeyFallback }),
    registry: buildRegistry(config),
  }).meta;
};

const availability = (options: readonly ModelOption[]) =>
  Object.fromEntries(
    options.map((option) => [option.selector, option.available])
  );

describe("meta.config", () => {
  it("is public and carries no secrets", async () => {
    const meta = setup(await seedWorld());
    const config = await call(meta.config, undefined, as(null));
    expect(config.brand.name).toBe("Test Chat");
    expect(JSON.stringify(config)).not.toContain("sk-");
  });
});

describe("meta.models", () => {
  it("needs a session", async () => {
    const meta = setup(await seedWorld());
    await expect(call(meta.models, {}, as(null))).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("marks models available by the keys that resolve in the personal context", async () => {
    const world = await seedWorld();
    const models = await call(setup(world).models, {}, as(world.alice.id));
    expect(availability(models)).toEqual({
      auto: false,
      fast: true,
      "ollama:llama-test": true,
      "openai:gpt-test": false,
    });
    expect(models.find((option) => option.selector === "fast")?.target).toBe(
      "anthropic:claude-test"
    );
  });

  it("uses the team's keys in a team context, and the user's only if the org allows", async () => {
    const world = await seedWorld();
    const input = { contextId: world.team.id, contextType: "team" as const };
    const strict = await call(setup(world).models, input, as(world.alice.id));
    expect(availability(strict)).toEqual({
      auto: false,
      fast: false,
      "ollama:llama-test": true,
      "openai:gpt-test": true,
    });
    const fallback = await call(
      setup(world, { personalKeyFallback: true }).models,
      input,
      as(world.alice.id)
    );
    expect(availability(fallback)).toMatchObject({ auto: true, fast: true });
  });

  it("refuses contexts the caller isn't in or the instance disallows", async () => {
    const world = await seedWorld();
    const meta = setup(world);
    await expect(
      call(
        meta.models,
        { contextId: world.team.id, contextType: "team" },
        as(world.outsider.id)
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      call(
        meta.models,
        { contextId: world.org.id, contextType: "org" },
        as(world.outsider.id)
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      call(meta.models, { contextType: "team" }, as(world.alice.id))
    ).rejects.toMatchObject({ code: "VALIDATION" });
    const personalOnly = setup(world, {
      config: { policies: { chatContext: ["personal"] } },
    });
    await expect(
      call(
        personalOnly.models,
        { contextId: world.org.id, contextType: "org" },
        as(world.alice.id)
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
