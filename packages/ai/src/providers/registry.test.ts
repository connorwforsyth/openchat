import { type AppConfigInput, appConfigSchema } from "@workspace/config/schema";
import { describe, expect, it } from "vitest";

import type { ProviderCredentials } from "../ports/provider-registry";
import { buildRegistry } from "./registry";

// Any request here is a bug: building models must not touch the network.
const noNetwork = () => {
  throw new Error("unexpected network call");
};

const registryFor = (input: AppConfigInput = {}) =>
  buildRegistry(appConfigSchema.parse(input), { fetch: noNetwork });

const OLLAMA = /^ollama/;

const key = (provider: string): ProviderCredentials => ({
  apiKey: "test-key-not-real",
  provider,
  source: { type: "instance" },
});

describe("buildRegistry", () => {
  it("boots on an empty config with the local Ollama default", () => {
    const registry = registryFor();
    const model = registry.languageModel("ollama:llama3.2", undefined);
    expect(model.ok && model.value.modelId).toBe("llama3.2");
    expect(model.ok && model.value.provider).toMatch(OLLAMA);
    expect(registry.listModels(new Set())).toEqual([]);
  });

  it("needs a key for hosted providers and never borrows another's", () => {
    const registry = registryFor({ providers: { anthropic: {} } });
    expect(
      registry.languageModel("anthropic:claude-opus-5-5", undefined)
    ).toEqual({
      error: { provider: "anthropic", type: "missing_key" },
      ok: false,
    });
    expect(
      registry.languageModel("anthropic:claude-opus-5-5", key("openai"))
    ).toMatchObject({ error: { type: "missing_key" }, ok: false });
    const model = registry.languageModel(
      "anthropic:claude-opus-5-5",
      key("anthropic")
    );
    expect(model.ok && model.value.modelId).toBe("claude-opus-5-5");
  });

  it.each([
    ["openai", { openai: {} }],
    ["google", { google: {} }],
    ["azure", { azure: { options: { resourceName: "example" } } }],
    ["bedrock", { bedrock: { options: { region: "us-east-1" } } }],
    [
      "openrouter",
      {
        openrouter: {
          baseURL: "https://openrouter.example/api/v1",
          options: { keyless: "false" },
          type: "openai-compatible" as const,
        },
      },
    ],
  ])("builds %s models from config", (provider, providers) => {
    const registry = registryFor({ providers });
    const model = registry.languageModel(
      `${provider}:some-model`,
      key(provider)
    );
    expect(model.ok && model.value.modelId).toBe("some-model");
    expect(registry.languageModel(`${provider}:some-model`, undefined).ok).toBe(
      false
    );
  });

  it("resolves aliases and refuses auto and unknown providers", () => {
    const registry = registryFor({
      models: { aliases: { fast: "openai:gpt-mini" } },
      providers: { openai: {} },
    });
    expect(registry.resolve("fast")).toEqual({
      ok: true,
      value: "openai:gpt-mini",
    });
    expect(registry.resolve("openai:gpt-big")).toEqual({
      ok: true,
      value: "openai:gpt-big",
    });
    expect(registry.resolve("auto")).toMatchObject({
      error: { type: "unknown_model" },
    });
    expect(registry.resolve("nope")).toMatchObject({
      error: { type: "unknown_model" },
    });
    expect(registry.resolve("mistral:large")).toMatchObject({
      error: { provider: "mistral", type: "unknown_provider" },
    });
  });

  it("reports a model kind the provider lacks as unsupported", () => {
    const registry = registryFor({ providers: { anthropic: {} } });
    expect(
      registry.embeddingModel("anthropic:embed", key("anthropic"))
    ).toMatchObject({ error: { type: "unsupported" }, ok: false });
  });

  it("lists auto, aliases and configured models with availability", () => {
    const registry = registryFor({
      models: {
        aliases: { fast: "ollama:qwen3", strong: "anthropic:claude-opus-5-5" },
        auto: { cheap: "fast", enabled: true, strong: "strong" },
      },
      providers: {
        anthropic: { models: ["claude-opus-5-5", "claude-haiku-5"] },
        ollama: {
          baseURL: "http://localhost:11434/v1",
          type: "openai-compatible",
        },
      },
    });
    const options = registry.listModels(new Set());
    expect(options.map((o) => [o.selector, o.available])).toEqual([
      ["auto", false],
      ["fast", true],
      ["strong", false],
      ["anthropic:claude-haiku-5", false],
    ]);
    const keyed = registry.listModels(new Set(["anthropic"]));
    expect(keyed.every((o) => o.available)).toBe(true);
  });
});
