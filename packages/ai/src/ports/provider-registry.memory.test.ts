import { keyScopeSchema } from "@workspace/contract/schemas/keys";
import { err } from "@workspace/shared/result";
import { MockEmbeddingModelV4, MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";

import type { ProviderCredentials } from "./provider-registry";
import { createMemoryProviderRegistry } from "./provider-registry.memory";

const strong = new MockLanguageModelV4({ modelId: "claude-opus-5-5" });
const local = new MockLanguageModelV4({ modelId: "llama3.2" });
const embed = new MockEmbeddingModelV4({ modelId: "text-embedding-3-small" });

const registry = createMemoryProviderRegistry({
  aliases: { fast: "ollama:llama3.2", strong: "anthropic:claude-opus-5-5" },
  embeddingModels: { "openai:text-embedding-3-small": embed },
  keyless: ["ollama"],
  languageModels: {
    "anthropic:claude-opus-5-5": strong,
    "ollama:llama3.2": local,
  },
});

const key = (provider: string): ProviderCredentials => ({
  apiKey: "test-key",
  provider,
  source: keyScopeSchema.parse({ type: "instance" }),
});

describe("memory ProviderRegistry", () => {
  it("resolves aliases and refs, but not auto or unknown names", () => {
    expect(registry.resolve("strong")).toEqual({
      ok: true,
      value: "anthropic:claude-opus-5-5",
    });
    expect(registry.resolve("ollama:llama3.2")).toEqual({
      ok: true,
      value: "ollama:llama3.2",
    });
    expect(registry.resolve("auto")).toEqual(
      err({ selector: "auto", type: "unknown_model" })
    );
    expect(registry.resolve("nope")).toEqual(
      err({ selector: "nope", type: "unknown_model" })
    );
    expect(registry.resolve("mistral:small")).toEqual(
      err({ provider: "mistral", type: "unknown_provider" })
    );
  });

  it("hands out models only with a key, unless the provider is keyless", () => {
    expect(registry.languageModel("anthropic:claude-opus-5-5")).toEqual(
      err({ provider: "anthropic", type: "missing_key" })
    );
    const withKey = registry.languageModel(
      "anthropic:claude-opus-5-5",
      key("anthropic")
    );
    expect(withKey.ok && withKey.value).toBe(strong);
    // A key for another provider doesn't count.
    expect(
      registry.languageModel("anthropic:claude-opus-5-5", key("openai")).ok
    ).toBe(false);
    const keyless = registry.languageModel("ollama:llama3.2");
    expect(keyless.ok && keyless.value).toBe(local);
  });

  it("hands out embedding models and says when there isn't one", () => {
    const result = registry.embeddingModel(
      "openai:text-embedding-3-small",
      key("openai")
    );
    expect(result.ok && result.value).toBe(embed);
    expect(registry.embeddingModel("ollama:llama3.2").ok).toBe(false);
  });

  it("marks picker options available by key", () => {
    const options = registry.listModels(new Set(["anthropic"]));
    expect(options.map((o) => [o.selector, o.available])).toEqual([
      ["fast", true],
      ["strong", true],
      ["anthropic:claude-opus-5-5", true],
      ["ollama:llama3.2", true],
    ]);
    expect(
      registry.listModels(new Set()).find((o) => o.selector === "strong")
        ?.available
    ).toBe(false);
  });
});
