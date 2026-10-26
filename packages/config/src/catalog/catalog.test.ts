import { describe, expect, it } from "vitest";

import { appConfigSchema } from "../schema";
import {
  catalogIdOf,
  normalizeModelId,
  ratingsOf,
  SPEED_STEPS,
  speedRating,
} from "./catalog";
import { GENERATED_CATALOG } from "./generated";
import { INTELLIGENCE } from "./intelligence";
import { intelligenceSchema } from "./schema";

const configOf = (input: unknown) => appConfigSchema.parse(input);

const providers = {
  anthropic: {},
  gateway: {
    baseURL: "https://ai-gateway.vercel.sh/v1",
    type: "openai-compatible",
  },
  ollama: { baseURL: "http://localhost:11434/v1", type: "openai-compatible" },
};

describe("speedRating", () => {
  it("steps up at fixed tokens per second", () => {
    expect(SPEED_STEPS).toEqual([50, 100, 150, 300]);
    expect(
      [1, 49, 50, 99, 100, 149, 150, 299, 300, 900].map(speedRating)
    ).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  });
});

describe("normalizeModelId", () => {
  it("spells Anthropic's API ids and the Gateway's alike", () => {
    expect(normalizeModelId("claude-haiku-5-5")).toBe(
      normalizeModelId("claude-haiku-5.5")
    );
    expect(normalizeModelId("claude-haiku-4-5-20251001")).toBe(
      normalizeModelId("claude-haiku-4.5")
    );
    expect(normalizeModelId("gpt-5")).not.toBe(normalizeModelId("gpt-5.5"));
  });
});

describe("catalogIdOf", () => {
  const { providers: parsed } = configOf({ providers });

  it("names a model as the Gateway does", () => {
    const at = (id: string, model: string) => {
      const provider = parsed[id];
      return provider && catalogIdOf(id, provider, model);
    };
    expect(at("anthropic", "claude-haiku-5-5")).toBe(
      "anthropic/claude-haiku-5-5"
    );
    expect(at("gateway", "anthropic/claude-haiku-5.5")).toBe(
      "anthropic/claude-haiku-5.5"
    );
    expect(at("ollama", "qwen2.5:3b")).toBe("ollama/qwen2.5:3b");
  });
});

describe("ratingsOf", () => {
  const haikuSpeed = speedRating(
    GENERATED_CATALOG.tokensPerSecond["anthropic/claude-haiku-5.5"]
  );

  it("rates a direct provider's model from the Gateway's speed and the curated list", () => {
    const config = configOf({ providers });
    const rated = {
      intelligence: INTELLIGENCE["anthropic/claude-haiku-5.5"],
      speed: haikuSpeed,
    };
    expect(
      ratingsOf(
        config,
        "anthropic:claude-haiku-5-5",
        "anthropic:claude-haiku-5-5"
      )
    ).toEqual(rated);
    expect(
      ratingsOf(
        config,
        "gateway:anthropic/claude-haiku-5.5",
        "gateway:anthropic/claude-haiku-5.5"
      )
    ).toEqual(rated);
  });

  it("rates local models only from the curated list", () => {
    expect(
      ratingsOf(
        configOf({ providers }),
        "ollama:qwen2.5:3b",
        "ollama:qwen2.5:3b"
      )
    ).toEqual({ intelligence: INTELLIGENCE["ollama/qwen2.5:3b"] });
    expect(
      ratingsOf(configOf({ providers }), "ollama:mystery", "ollama:mystery")
    ).toBeUndefined();
  });

  it("lets app.config win field by field, the alias over its ref", () => {
    const config = configOf({
      models: {
        aliases: { fast: "anthropic:claude-haiku-5-5" },
        ratings: {
          "anthropic:claude-haiku-5-5": { intelligence: 1, speed: 2 },
          fast: { speed: 5 },
        },
      },
      providers,
    });
    expect(ratingsOf(config, "fast", "anthropic:claude-haiku-5-5")).toEqual({
      intelligence: 1,
      speed: 5,
    });
    const own = configOf({
      models: {
        ratings: { "anthropic:claude-haiku-5-5": { intelligence: 2 } },
      },
      providers,
    });
    expect(
      ratingsOf(own, "anthropic:claude-haiku-5-5", "anthropic:claude-haiku-5-5")
    ).toEqual({ intelligence: 2, speed: haikuSpeed });
  });
});

describe("the curated intelligence list", () => {
  it("rates 1 to 5", () => {
    expect(intelligenceSchema.safeParse(INTELLIGENCE).success).toBe(true);
  });
});
