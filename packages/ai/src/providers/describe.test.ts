import { type AppConfigInput, appConfigSchema } from "@workspace/config/schema";
import { describe, expect, it } from "vitest";

import type { ProviderCredentials } from "../ports/provider-registry";
import { DESCRIPTION_MAX, oneLine, vendorOf } from "./describe";
import { buildRegistry } from "./registry";

// Descriptions and vendors in the picker (096). Every `fetch` is a fake.

const ELLIPSIS_END = /…$/;

const key = (provider: string): ProviderCredentials => ({
  apiKey: "test-key-not-real",
  provider,
  source: { type: "instance" },
});

describe("oneLine", () => {
  it("keeps the first non-blank line, whitespace collapsed", () => {
    expect(oneLine("\n  Quick   everyday\tanswers \nSecond line")).toBe(
      "Quick everyday answers"
    );
    expect(oneLine("  \n ")).toBeUndefined();
    expect(oneLine(null)).toBeUndefined();
  });

  it("caps the length at a word, with an ellipsis", () => {
    const long = `${"word ".repeat(60)}end`;
    const capped = oneLine(long);
    expect(capped?.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    expect(capped?.endsWith("word…")).toBe(true);
    // One long token is cut where it has to be.
    const token = oneLine("x".repeat(500));
    expect(token).toBe(`${"x".repeat(DESCRIPTION_MAX - 1)}…`);
    expect(oneLine("x".repeat(DESCRIPTION_MAX))).toBe(
      "x".repeat(DESCRIPTION_MAX)
    );
  });
});

describe("vendorOf", () => {
  it("reads an aggregator's vendor, else the provider", () => {
    expect(vendorOf("gateway:anthropic/claude-haiku-4.5")).toBe("anthropic");
    expect(vendorOf("openrouter:OpenAI/gpt-5")).toBe("openai");
    expect(vendorOf("anthropic:claude-opus-5-5")).toBe("anthropic");
    expect(vendorOf("ollama:llama3.2:latest")).toBe("ollama");
    // One vendor under two aggregators' names shares one group (Connor, 2026-10-01).
    expect(vendorOf("openrouter:meta-llama/llama-4-maverick")).toBe("meta");
    expect(vendorOf("gateway:meta/llama-4-maverick")).toBe("meta");
  });
});

const CATALOG = {
  data: [
    {
      description: "From the catalog: haiku.",
      id: "anthropic/claude-haiku-4.5",
    },
    {
      description: "From the catalog: sonnet.\nWith a second line.",
      id: "anthropic/claude-sonnet-4.5",
    },
    { description: `${"Long ".repeat(50)}tail`, id: "openai/gpt-5-mini" },
    { id: "openai/gpt-4.1" },
  ],
};

const config = (descriptions: Record<string, string>): AppConfigInput => ({
  models: {
    aliases: {
      fast: "gateway:anthropic/claude-haiku-4.5",
      strong: "anthropic:claude-opus-5-5",
    },
    auto: { cheap: "fast", enabled: true, strong: "strong" },
    descriptions,
  },
  providers: {
    anthropic: {},
    gateway: {
      baseURL: "https://gateway.example/v1",
      discover: true,
      models: ["openai/gpt-4.1"],
      options: { keyless: "false" },
      type: "openai-compatible",
    },
  },
});

const fetchCatalog = (() =>
  Promise.resolve(Response.json(CATALOG))) as unknown as typeof fetch;

const listed = async (descriptions: Record<string, string>) => {
  const registry = buildRegistry(appConfigSchema.parse(config(descriptions)), {
    fetch: fetchCatalog,
  });
  const options = await registry.listModels({
    anthropic: key("anthropic"),
    gateway: key("gateway"),
  });
  return Object.fromEntries(
    options.map((option) => [
      option.selector,
      { description: option.description, provider: option.provider },
    ])
  );
};

describe("listModels descriptions", () => {
  it("prefers the config (by alias, then by ref) to the catalog", async () => {
    const options = await listed({
      fast: "Quick everyday answers",
      "gateway:anthropic/claude-haiku-4.5": "Loses to the alias's own",
      "gateway:anthropic/claude-sonnet-4.5": "Configured by ref",
      strong: "  Hard problems,\n  long context  ",
    });
    expect(options).toEqual({
      auto: { description: undefined, provider: undefined },
      fast: { description: "Quick everyday answers", provider: "anthropic" },
      "gateway:anthropic/claude-sonnet-4.5": {
        description: "Configured by ref",
        provider: "anthropic",
      },
      "gateway:openai/gpt-4.1": { description: undefined, provider: "openai" },
      "gateway:openai/gpt-5-mini": {
        description: expect.stringMatching(ELLIPSIS_END),
        provider: "openai",
      },
      strong: { description: "Hard problems,", provider: "anthropic" },
    });
  });

  it("falls back to the catalog's, trimmed to one capped line", async () => {
    const options = await listed({});
    expect(options.fast?.description).toBe("From the catalog: haiku.");
    expect(options["gateway:anthropic/claude-sonnet-4.5"]?.description).toBe(
      "From the catalog: sonnet."
    );
    const long = options["gateway:openai/gpt-5-mini"]?.description ?? "";
    expect(long.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    // Without a catalog entry or a config line there's none, and auto has
    // no description or vendor: the UI says what it is.
    expect(options["gateway:openai/gpt-4.1"]?.description).toBeUndefined();
    expect(options.auto).toEqual({
      description: undefined,
      provider: undefined,
    });
  });

  it("describes configured models even without discovery", async () => {
    const registry = buildRegistry(
      appConfigSchema.parse({
        models: { descriptions: { "openai:gpt-test": "Everyday chat" } },
        providers: { openai: { models: ["gpt-test"] } },
      })
    );
    const options = await registry.listModels({});
    expect(options).toContainEqual(
      expect.objectContaining({
        description: "Everyday chat",
        provider: "openai",
        selector: "openai:gpt-test",
      })
    );
  });
});

describe("the descriptions config", () => {
  it("takes aliases and refs to configured providers, not auto", () => {
    const parsed = appConfigSchema.safeParse(
      config({
        auto: "Mine",
        "mistral:small": "Unknown provider",
        nope: "Unknown alias",
      })
    );
    expect(parsed.success).toBe(false);
    expect(
      parsed.error?.issues.map((issue) => issue.path.join(".")).sort()
    ).toEqual([
      "models.descriptions.auto",
      "models.descriptions.mistral:small",
      "models.descriptions.nope",
    ]);
  });
});
