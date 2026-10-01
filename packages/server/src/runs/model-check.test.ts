import { createMemoryKeyStore } from "@workspace/ai/keys/key-store.memory";
import { buildRegistry } from "@workspace/ai/providers/registry";
import { appConfigSchema } from "@workspace/config/schema";
import type { UserId } from "@workspace/contract/schemas/common";
import type { Db } from "@workspace/db/client";
import { newId } from "@workspace/shared/ids";
import { describe, expect, it } from "vitest";

import { createModelLoader } from "./turn";

// A run's model goes through the same check the picker applies (095): a
// discovering provider runs what its catalog lists within its patterns, and
// the configured models always. The catalog is a canned response; nothing
// here reaches a provider, and building a model makes no call.

const userId = newId("user") as UserId;
const caller = { context: { type: "personal" as const }, userId };
const state = { facts: {}, history: [], input: "hi" };

const config = appConfigSchema.parse({
  models: { aliases: { fast: "gateway:anthropic/claude-haiku-4.5" } },
  providers: {
    gateway: {
      baseURL: "https://gateway.example/v1",
      discover: true,
      exclude: ["*-pro"],
      include: ["anthropic/*", "openai/gpt-5*"],
      models: ["openai/gpt-4.1"],
      options: { keyless: "false" },
      type: "openai-compatible",
    },
  },
});

const catalog = {
  data: [
    { id: "anthropic/claude-haiku-4.5" },
    { id: "openai/gpt-5-mini", tags: ["reasoning"] },
    { id: "openai/gpt-5-pro" },
    { id: "xai/grok-4" },
  ],
};

const loaderWith = (instanceKey: boolean) => {
  const fetches: string[] = [];
  const fetch = ((input: RequestInfo | URL) => {
    fetches.push(String(input));
    return Promise.resolve(Response.json(catalog));
  }) as typeof globalThis.fetch;
  const registry = buildRegistry(config, { fetch });
  const loader = createModelLoader({
    catalog: registry.catalog,
    config,
    // The personal context resolves keys without the database.
    db: {} as Db,
    keyStore: createMemoryKeyStore(
      instanceKey
        ? [
            {
              apiKey: "test-key-not-real",
              provider: "gateway",
              source: { type: "instance" },
            },
          ]
        : []
    ),
    registry,
  });
  return {
    fetches,
    load: (selector: string) => loader(caller, selector, { state }),
  };
};

describe("the run's model check", () => {
  it("runs a discovered model inside the patterns", async () => {
    const { fetches, load } = loaderWith(true);
    const loaded = await load("gateway:openai/gpt-5-mini");
    expect(loaded.ok && loaded.value.resolvedModel).toBe(
      "gateway:openai/gpt-5-mini"
    );
    expect(loaded.ok && loaded.value.paidBy).toEqual({ type: "instance" });
    expect(fetches).toEqual(["https://gateway.example/v1/models"]);
  });

  it("says when the catalog says the model reasons (105)", async () => {
    const { load } = loaderWith(true);
    const mini = await load("gateway:openai/gpt-5-mini");
    expect(mini.ok && mini.value.reasons).toBe(true);
    const haiku = await load("gateway:anthropic/claude-haiku-4.5");
    expect(haiku.ok && haiku.value.reasons).toBeUndefined();
  });

  it.each([
    ["excluded", "gateway:openai/gpt-5-pro"],
    ["not included", "gateway:xai/grok-4"],
    ["not in the catalog", "gateway:anthropic/claude-imaginary"],
  ])("refuses a model that's %s", async (_, ref) => {
    const { load } = loaderWith(true);
    expect(await load(ref)).toEqual({
      error: {
        code: "provider_unavailable",
        message: `${ref} isn't offered on this instance.`,
        retryable: false,
      },
      ok: false,
    });
  });

  it("always runs configured models and aliases", async () => {
    const { load } = loaderWith(true);
    const loaded = await Promise.all(
      ["fast", "gateway:openai/gpt-4.1"].map((selector) => load(selector))
    );
    expect(loaded.map((result) => result.ok)).toEqual([true, true]);
  });

  it("still says there's no key when there isn't one", async () => {
    const { fetches, load } = loaderWith(false);
    expect(await load("gateway:openai/gpt-5-mini")).toMatchObject({
      error: { message: "No key for gateway is available in this chat." },
      ok: false,
    });
    expect(fetches).toEqual([]);
  });
});
