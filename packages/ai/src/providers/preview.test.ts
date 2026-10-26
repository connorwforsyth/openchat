import { appConfigSchema } from "@workspace/config/schema";
import { describe, expect, it } from "vitest";

import type { ProviderCredentials } from "../ports/provider-registry";
import { parseCatalog } from "./catalog";
import {
  capabilitiesWith,
  costOf,
  displayNameOf,
  tidyModelName,
} from "./describe";
import { buildRegistry } from "./registry";

// What the picker's preview card says about a model (099): its name, cost,
// ratings and capabilities. Every `fetch` is a fake; unknown stays absent.

const key = (provider: string): ProviderCredentials => ({
  apiKey: "test-key-not-real",
  provider,
  source: { type: "instance" },
});

describe("tidyModelName", () => {
  it.each([
    ["anthropic/claude-opus-4-5", "Claude Opus 4.5"],
    ["claude-3-5-sonnet-20241022", "Claude 3.5 Sonnet"],
    ["gpt-4o-mini", "GPT-4o Mini"],
    ["gpt-4o-2024-08-06", "GPT-4o"],
    ["gpt-5", "GPT-5"],
    ["o3-mini", "o3 Mini"],
    ["gemini-2.5-pro", "Gemini 2.5 Pro"],
    ["llama3.2:3b", "Llama3.2 3B"],
    ["llama3.2:latest", "Llama3.2"],
    ["deepseek/deepseek-r1", "DeepSeek R1"],
    ["moonshotai/kimi-k2", "Kimi K2"],
    ["gpt-oss-120b", "GPT-OSS 120B"],
    ["chatgpt-4o-latest", "ChatGPT 4o"],
  ])("%s is %s", (id, name) => {
    expect(tidyModelName(id)).toBe(name);
  });
});

describe("displayNameOf", () => {
  it("prefers the catalog's name, without OpenRouter's vendor prefix", () => {
    expect(displayNameOf("claude-opus-4", "Claude Opus 4")).toBe(
      "Claude Opus 4"
    );
    expect(
      displayNameOf("anthropic/claude-opus-4", "Anthropic: Claude Opus 4")
    ).toBe("Claude Opus 4");
    expect(displayNameOf("anthropic/claude-opus-4", null)).toBe(
      "Claude Opus 4"
    );
    expect(displayNameOf("gpt-5", "  ")).toBe("GPT-5");
  });
});

describe("costOf", () => {
  it("tiers a blended price (3 in : 1 out) and keeps the prices", () => {
    expect(costOf({ input: 150_000, output: 600_000 })?.tier).toBe(1);
    expect(costOf({ input: 1_000_000, output: 5_000_000 })?.tier).toBe(2);
    expect(costOf({ input: 3_000_000, output: 15_000_000 })).toEqual({
      input: 3_000_000,
      output: 15_000_000,
      tier: 3,
    });
    expect(costOf({ input: 5_000_000, output: 25_000_000 })?.tier).toBe(4);
    expect(costOf({ input: 15_000_000, output: 75_000_000 })?.tier).toBe(5);
    expect(costOf({ input: 0 })).toEqual({ input: 0, tier: 1 });
  });

  it("is absent when no price is known", () => {
    expect(costOf(undefined)).toBeUndefined();
    expect(costOf({})).toBeUndefined();
  });
});

describe("capabilitiesWith", () => {
  it("removes what the catalog denies and adds reasoning it confirms", () => {
    expect(
      capabilitiesWith(["tools", "vision", "files"], { reasoning: true })
    ).toEqual(["tools", "vision", "files", "reasoning"]);
    expect(
      capabilitiesWith(["tools", "vision", "files"], {
        tools: false,
        vision: false,
      })
    ).toEqual(["files"]);
  });

  it("never adds vision or files the provider config doesn't send", () => {
    expect(capabilitiesWith(["tools"], { files: true, vision: true })).toEqual([
      "tools",
    ]);
    expect(capabilitiesWith(["tools"], undefined)).toEqual(["tools"]);
  });

  it("adds vision when the model server's own catalog says yes", () => {
    const fromServer = { fromServer: true };
    expect(capabilitiesWith(["tools"], { vision: true }, fromServer)).toEqual([
      "tools",
      "vision",
    ]);
    expect(capabilitiesWith(["tools"], { vision: false }, fromServer)).toEqual([
      "tools",
    ]);
  });
});

describe("parseCatalog's prices and traits", () => {
  it("reads the Vercel AI Gateway's per-token prices and tags", () => {
    expect(
      parseCatalog("openai", {
        data: [
          {
            id: "anthropic/claude-sonnet-4.5",
            pricing: { input: "0.000003", output: "0.000015" },
            tags: ["tool-use", "reasoning", "vision", "file-input"],
            type: "language",
          },
          { id: "openai/gpt-5-mini", tags: [] },
        ],
      })
    ).toEqual([
      expect.objectContaining({
        pricing: { input: 3_000_000, output: 15_000_000 },
        traits: { files: true, reasoning: true, tools: true, vision: true },
      }),
      // An empty tag list says nothing, so nothing is denied.
      {
        contextWindow: null,
        description: null,
        id: "openai/gpt-5-mini",
        name: null,
      },
    ]);
  });

  it("reads OpenRouter's prices, parameters and inputs, where a missing one means no", () => {
    expect(
      parseCatalog("openai", {
        data: [
          {
            architecture: { input_modalities: ["text"] },
            id: "meta-llama/llama-3-8b",
            name: "Meta: Llama 3 8B",
            pricing: { completion: "0.0000001", prompt: "-1" },
            supported_parameters: ["temperature", "tools"],
          },
        ],
      })
    ).toEqual([
      {
        contextWindow: null,
        description: null,
        id: "meta-llama/llama-3-8b",
        name: "Meta: Llama 3 8B",
        // A negative price is "varies": unknown, not free.
        pricing: { output: 100_000 },
        traits: { files: false, reasoning: false, tools: true, vision: false },
      },
    ]);
  });

  it("reads Google's thinking flag", () => {
    expect(
      parseCatalog("google", {
        models: [
          { name: "models/gemini-2.5-pro", thinking: true },
          { name: "models/gemini-2.0-flash", thinking: false },
          { name: "models/gemma-3" },
        ],
      })?.map((model) => model.traits)
    ).toEqual([{ reasoning: true }, { reasoning: false }, undefined]);
  });
});

const GATEWAY = {
  data: [
    {
      context_window: 200_000,
      id: "anthropic/claude-haiku-4.5",
      name: "Claude Haiku 4.5",
      pricing: { input: "0.000001", output: "0.000005" },
      tags: ["tool-use", "vision", "reasoning"],
    },
    { id: "openai/gpt-4.1" },
  ],
};

const registryWith = (
  ratings: Record<string, unknown>,
  prices: Record<string, unknown> = {}
) =>
  buildRegistry(
    appConfigSchema.parse({
      models: {
        aliases: {
          fast: "gateway:anthropic/claude-haiku-4.5",
          strong: "anthropic:claude-opus-5-5",
        },
        auto: { cheap: "fast", enabled: true, strong: "strong" },
        prices,
        ratings,
      },
      providers: {
        anthropic: {},
        gateway: {
          baseURL: "https://gateway.example/v1",
          discover: true,
          options: { keyless: "false" },
          type: "openai-compatible",
        },
      },
    }),
    {
      fetch: (() =>
        Promise.resolve(Response.json(GATEWAY))) as unknown as typeof fetch,
    }
  );

const bySelector = async (
  ratings: Record<string, unknown> = {},
  prices: Record<string, unknown> = {}
) => {
  const options = await registryWith(ratings, prices).listModels({
    anthropic: key("anthropic"),
    gateway: key("gateway"),
  });
  return new Map(options.map((option) => [option.selector, option]));
};

describe("listModels' preview facts", () => {
  it("fills name, cost and capabilities from the catalog", async () => {
    const fast = (await bySelector()).get("fast");
    expect(fast).toMatchObject({
      // The gateway sends images only when its config says so, so vision
      // stays off; reasoning comes from the tag.
      capabilities: ["tools", "reasoning"],
      contextWindow: 200_000,
      cost: { input: 1_000_000, output: 5_000_000, tier: 2 },
      displayName: "Claude Haiku 4.5",
      label: "fast",
    });
    expect(fast?.ratings).toBeUndefined();
  });

  it("derives a name without a catalog, and invents nothing else", async () => {
    const options = await bySelector();
    const strong = options.get("strong");
    expect(strong?.displayName).toBe("Claude Opus 5.5");
    expect(strong?.capabilities).toEqual(["tools", "vision", "files"]);
    const gpt = options.get("gateway:openai/gpt-4.1");
    expect(gpt?.displayName).toBe("GPT-4.1");
    expect(gpt).not.toHaveProperty("cost");
    // Auto is the UI's to describe.
    expect(options.get("auto")).not.toHaveProperty("displayName");
  });

  it("prices and rates a known model from the repo's model catalogue", async () => {
    const strong = (await bySelector()).get("strong");
    expect(strong?.cost?.input).toBeGreaterThan(0);
    expect(strong?.ratings?.intelligence).toBeDefined();
  });

  it("shows the operator's price first, then the provider catalog's", async () => {
    const options = await bySelector(
      {},
      {
        "anthropic:claude-opus-5-5": {
          inputMicros: 5_000_000,
          outputMicros: 25_000_000,
        },
        "gateway:anthropic/claude-haiku-4.5": {
          inputMicros: 1,
          outputMicros: 1,
        },
      }
    );
    expect(options.get("strong")?.cost).toEqual({
      input: 5_000_000,
      output: 25_000_000,
      tier: 4,
    });
    // The catalog lists $1/$5, but the operator's price is what usage is billed at.
    expect(options.get("fast")?.cost?.tier).toBe(1);
  });

  it("rates from config, the alias's rating beating its ref's", async () => {
    const options = await bySelector({
      fast: { speed: 5 },
      "gateway:anthropic/claude-haiku-4.5": { intelligence: 1, speed: 1 },
      "gateway:openai/gpt-4.1": { intelligence: 4 },
    });
    expect(options.get("fast")?.ratings).toEqual({ intelligence: 1, speed: 5 });
    expect(options.get("gateway:openai/gpt-4.1")?.ratings).toEqual({
      intelligence: 4,
    });
  });
});

describe("the ratings config", () => {
  it("takes 1–5 for aliases and refs to configured providers, not auto", () => {
    const parsed = appConfigSchema.safeParse({
      models: {
        aliases: { fast: "anthropic:claude-haiku-4-5" },
        ratings: {
          "anthropic:claude-opus-5-5": {},
          auto: { speed: 3 },
          fast: { speed: 6 },
          "mistral:small": { speed: 2 },
          nope: { intelligence: 2 },
        },
      },
      providers: { anthropic: {} },
    });
    expect(parsed.success).toBe(false);
    expect(
      parsed.error?.issues.map((issue) => issue.path.join(".")).sort()
    ).toEqual([
      "models.ratings.anthropic:claude-opus-5-5",
      "models.ratings.auto",
      "models.ratings.fast.speed",
      "models.ratings.mistral:small",
      "models.ratings.nope",
    ]);
  });
});
