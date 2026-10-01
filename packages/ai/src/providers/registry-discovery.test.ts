import { type AppConfigInput, appConfigSchema } from "@workspace/config/schema";
import { describe, expect, it } from "vitest";

import type { ProviderCredentials } from "../ports/provider-registry";
import { buildRegistry, type RegistryOptions } from "./registry";

// Discovery (095) against canned catalogs: every `fetch` here is a fake, so
// no test reaches a provider.

const key = (
  provider: string,
  apiKey = "test-key-not-real"
): ProviderCredentials => ({
  apiKey,
  provider,
  source: { type: "instance" },
});

const GATEWAY_MODELS = {
  data: [
    {
      context_window: 200_000,
      description: "Fast and cheap.",
      id: "anthropic/claude-haiku-4.5",
      name: "Claude Haiku 4.5",
      type: "language",
    },
    {
      context_window: 1_000_000,
      id: "anthropic/claude-sonnet-4.5",
      type: "language",
    },
    { id: "openai/gpt-5-mini", type: "language" },
    { id: "openai/gpt-5-pro", type: "language" },
    { id: "xai/grok-4", type: "language" },
    { id: "openai/text-embedding-3-small", type: "embedding" },
  ],
};

/** A `fetch` that answers from `respond`, counting calls. */
const counting = (respond: () => Promise<Response>) => {
  const calls: string[] = [];
  const fetch = ((input: RequestInfo | URL) => {
    calls.push(String(input));
    return respond();
  }) as typeof globalThis.fetch;
  return { calls, fetch };
};

const json =
  (body: unknown, status = 200) =>
  () =>
    Promise.resolve(new Response(JSON.stringify(body), { status }));

const gatewayConfig = (
  overrides: Record<string, unknown> = {}
): AppConfigInput => ({
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
      ...overrides,
    },
  },
});

const build = (input: AppConfigInput, options: RegistryOptions) =>
  buildRegistry(appConfigSchema.parse(input), options);

const selectors = (options: readonly { selector: string }[]) =>
  options.map((option) => option.selector);

describe("model discovery", () => {
  it("leaves a provider without `discover` exactly as configured", async () => {
    const { calls, fetch } = counting(json(GATEWAY_MODELS));
    const registry = build(
      gatewayConfig({ discover: false, exclude: [], include: [] }),
      {
        fetch,
      }
    );
    expect(
      selectors(await registry.listModels({ gateway: key("gateway") }))
    ).toEqual(["fast", "gateway:openai/gpt-4.1"]);
    expect(calls).toEqual([]);
    // As before 095: any id on a configured provider may run.
    expect(
      await registry.checkModel("gateway:xai/grok-4", key("gateway"))
    ).toEqual({
      ok: true,
      value: "gateway:xai/grok-4",
    });
  });

  it("lists the catalog through include/exclude, after the configured models", async () => {
    const { calls, fetch } = counting(json(GATEWAY_MODELS));
    const registry = build(gatewayConfig(), { fetch });
    const options = await registry.listModels({ gateway: key("gateway") });
    expect(options).toEqual([
      {
        available: true,
        capabilities: ["tools"],
        contextWindow: 200_000,
        description: "Fast and cheap.",
        label: "fast",
        provider: "anthropic",
        selector: "fast",
        target: "gateway:anthropic/claude-haiku-4.5",
      },
      {
        available: true,
        capabilities: ["tools"],
        contextWindow: null,
        label: "openai/gpt-4.1",
        provider: "openai",
        selector: "gateway:openai/gpt-4.1",
        target: "gateway:openai/gpt-4.1",
      },
      {
        available: true,
        capabilities: ["tools"],
        contextWindow: 1_000_000,
        label: "anthropic/claude-sonnet-4.5",
        provider: "anthropic",
        selector: "gateway:anthropic/claude-sonnet-4.5",
        target: "gateway:anthropic/claude-sonnet-4.5",
      },
      {
        available: true,
        capabilities: ["tools"],
        contextWindow: null,
        label: "openai/gpt-5-mini",
        provider: "openai",
        selector: "gateway:openai/gpt-5-mini",
        target: "gateway:openai/gpt-5-mini",
      },
    ]);
    expect(calls).toEqual(["https://gateway.example/v1/models"]);
    // Names stay on the server side; descriptions are in the list (096).
    const catalog = await registry.catalog("gateway", key("gateway"));
    expect(
      catalog?.find((model) => model.id === "anthropic/claude-haiku-4.5")
    ).toEqual({
      contextWindow: 200_000,
      description: "Fast and cheap.",
      id: "anthropic/claude-haiku-4.5",
      name: "Claude Haiku 4.5",
    });
  });

  it("reads a keyless Ollama's tags", async () => {
    const { calls, fetch } = counting(
      json({
        models: [
          { name: "llama3.2:latest" },
          { name: "nomic-embed-text:latest" },
        ],
      })
    );
    const registry = build(
      {
        providers: {
          ollama: {
            baseURL: "http://localhost:11434/v1",
            discover: true,
            exclude: ["*embed*"],
            type: "openai-compatible",
          },
        },
      },
      { fetch }
    );
    const options = await registry.listModels({});
    expect(
      options.map((option) => [option.selector, option.available])
    ).toEqual([["ollama:llama3.2:latest", true]]);
    expect(calls).toEqual(["http://localhost:11434/api/tags"]);
  });

  it("fetches nothing without a key, and lists the configured models as unavailable", async () => {
    const { calls, fetch } = counting(json(GATEWAY_MODELS));
    const registry = build(gatewayConfig(), { fetch });
    const options = await registry.listModels({ other: key("other") });
    expect(
      options.map((option) => [option.selector, option.available])
    ).toEqual([
      ["fast", false],
      ["gateway:openai/gpt-4.1", false],
    ]);
    expect(calls).toEqual([]);
  });

  it("caches per provider and key until the TTL runs out", async () => {
    const { calls, fetch } = counting(json(GATEWAY_MODELS));
    let now = 0;
    const registry = build(gatewayConfig({ discoverTtlSeconds: 60 }), {
      fetch,
      now: () => now,
    });
    await registry.listModels({ gateway: key("gateway") });
    await registry.listModels({ gateway: key("gateway") });
    await registry.checkModel("gateway:openai/gpt-5-mini", key("gateway"));
    expect(calls).toHaveLength(1);
    // Another context's key gets its own catalog.
    await registry.listModels({ gateway: key("gateway", "another-test-key") });
    expect(calls).toHaveLength(2);
    now = 61_000;
    await registry.listModels({ gateway: key("gateway") });
    expect(calls).toHaveLength(3);
  });

  it("shares one fetch between callers that arrive together", async () => {
    const { calls, fetch } = counting(json(GATEWAY_MODELS));
    const registry = build(gatewayConfig(), { fetch });
    await Promise.all([
      registry.listModels({ gateway: key("gateway") }),
      registry.listModels({ gateway: key("gateway") }),
    ]);
    expect(calls).toHaveLength(1);
  });

  it("falls back to the configured models when the catalog fails, logging once", async () => {
    const { calls, fetch } = counting(json({ error: "down" }, 503));
    const logs: string[] = [];
    let now = 0;
    const registry = build(gatewayConfig(), {
      fetch,
      log: (message) => logs.push(message),
      now: () => now,
    });
    expect(
      selectors(await registry.listModels({ gateway: key("gateway") }))
    ).toEqual(["fast", "gateway:openai/gpt-4.1"]);
    // Retried after a minute, not an hour; still logged only once.
    now = 61_000;
    await registry.listModels({ gateway: key("gateway") });
    expect(calls).toHaveLength(2);
    expect(logs).toEqual([
      'model discovery for provider "gateway" failed (HTTP 503); offering its configured models until it answers',
    ]);
    expect(logs.join()).not.toContain("test-key-not-real");
    expect(logs.join()).not.toContain("gateway.example");
  });

  it("refuses to run what the patterns or the catalog leave out", async () => {
    const { fetch } = counting(json(GATEWAY_MODELS));
    const registry = build(gatewayConfig(), { fetch });
    const check = (ref: string, credentials = key("gateway")) =>
      registry.checkModel(ref, credentials);

    expect(await check("gateway:openai/gpt-5-mini")).toMatchObject({
      ok: true,
    });
    // Excluded, not included, and not in the catalog.
    const refused = [
      "gateway:openai/gpt-5-pro",
      "gateway:xai/grok-4",
      "gateway:anthropic/claude-imaginary",
    ];
    expect(await Promise.all(refused.map((ref) => check(ref)))).toEqual(
      refused.map((ref) => ({
        error: { selector: ref, type: "not_offered" },
        ok: false,
      }))
    );
    // Configured models and alias targets always run.
    expect(await check("gateway:openai/gpt-4.1")).toMatchObject({ ok: true });
    expect(await check("gateway:anthropic/claude-haiku-4.5")).toMatchObject({
      ok: true,
    });
    // No key reads as no key, as it does for a model call.
    expect(
      await registry.checkModel("gateway:openai/gpt-5-mini", undefined)
    ).toEqual({
      error: { provider: "gateway", type: "missing_key" },
      ok: false,
    });
  });

  it("runs only the configured models while the catalog is down", async () => {
    const { fetch } = counting(() =>
      Promise.reject(new TypeError("fetch failed"))
    );
    const registry = build(gatewayConfig(), { fetch });
    expect(
      await registry.checkModel("gateway:openai/gpt-5-mini", key("gateway"))
    ).toMatchObject({ error: { type: "not_offered" }, ok: false });
    expect(
      await registry.checkModel("gateway:openai/gpt-4.1", key("gateway"))
    ).toMatchObject({ ok: true });
  });

  it("applies include/exclude to hand-typed refs without discovery too", async () => {
    const registry = build(
      gatewayConfig({ discover: false, include: ["openai/*"] }),
      { fetch: counting(json({})).fetch }
    );
    expect(
      await registry.checkModel("gateway:openai/gpt-5-mini", key("gateway"))
    ).toMatchObject({ ok: true });
    expect(
      await registry.checkModel("gateway:xai/grok-4", key("gateway"))
    ).toMatchObject({ error: { type: "not_offered" }, ok: false });
  });
});

describe("the discover config", () => {
  it("is off by default", () => {
    const config = appConfigSchema.parse({ providers: { openai: {} } });
    expect(config.providers.openai).toMatchObject({
      discover: false,
      discoverTtlSeconds: 3600,
      exclude: [],
      include: [],
    });
  });

  it("refuses discovery where there's no catalog", () => {
    const parsed = appConfigSchema.safeParse({
      providers: {
        bedrock: { discover: true, options: { region: "us-east-1" } },
      },
    });
    expect(parsed.success).toBe(false);
  });
});
