import { describe, expect, it } from "vitest";

import { imageCost, type ModelPrices, usageCost } from "./prices";
import { appConfigSchema } from "./schema";

const prices: ModelPrices = {
  // $3.00 in, $15.00 out, $0.30 cached, per million tokens.
  "anthropic:strong": {
    cachedInputMicros: 300_000,
    inputMicros: 3_000_000,
    outputMicros: 15_000_000,
  },
  "local:free": { inputMicros: 0, outputMicros: 0 },
  // $0.15 in, $0.60 out; cached input isn't priced apart.
  "openai:cheap": { inputMicros: 150_000, outputMicros: 600_000 },
  // One micro-USD per million tokens: every call is a rounding case.
  "test:tiny": { inputMicros: 1, outputMicros: 1 },
};

const cost = (
  model: string,
  inputTokens: number,
  outputTokens: number,
  cachedInputTokens?: number
) => usageCost(prices, model, { cachedInputTokens, inputTokens, outputTokens });

describe("usageCost", () => {
  it("charges input and output at their own price", () => {
    // 1000 × $3/M + 500 × $15/M = $0.003 + $0.0075
    expect(cost("anthropic:strong", 1000, 500)).toEqual({
      costMicros: 10_500,
      priced: true,
    });
    expect(cost("openai:cheap", 1_000_000, 1_000_000).costMicros).toBe(750_000);
  });

  it("rounds half up to a whole micro-USD, once, on the sum", () => {
    expect(cost("test:tiny", 499_999, 0).costMicros).toBe(0);
    expect(cost("test:tiny", 500_000, 0).costMicros).toBe(1);
    expect(cost("test:tiny", 1_499_999, 0).costMicros).toBe(1);
    expect(cost("test:tiny", 1_500_000, 0).costMicros).toBe(2);
    // Each side alone rounds down to 0; together they are half a micro.
    expect(cost("test:tiny", 250_000, 250_000).costMicros).toBe(1);
    // 1 token × $0.15/M is 0.15 micro-USD.
    expect(cost("openai:cheap", 1, 0).costMicros).toBe(0);
    expect(cost("openai:cheap", 3, 0).costMicros).toBe(0);
    expect(cost("openai:cheap", 4, 0).costMicros).toBe(1);
  });

  it("is exact where floating point isn't", () => {
    // 0.1 + 0.2 territory: 3 × 100_000 / 1e6 and 7 × 300_000 / 1e6.
    const drift: ModelPrices = {
      "test:a": { inputMicros: 100_000, outputMicros: 300_000 },
    };
    expect(
      usageCost(drift, "test:a", { inputTokens: 5, outputTokens: 0 }).costMicros
    ).toBe(1);
    expect(
      usageCost(drift, "test:a", { inputTokens: 3, outputTokens: 7 }).costMicros
    ).toBe(2);
  });

  it("costs 0 and says so when the model has no price", () => {
    expect(cost("openai:unlisted", 1_000_000, 1_000_000)).toEqual({
      costMicros: 0,
      priced: false,
    });
    expect(
      usageCost({}, "anthropic:strong", { inputTokens: 9, outputTokens: 9 })
    ).toEqual({ costMicros: 0, priced: false });
    // Not a price: an object key every record inherits.
    expect(cost("constructor", 1, 1).priced).toBe(false);
  });

  it("tells a free model from an unpriced one", () => {
    expect(cost("local:free", 1_000_000, 1_000_000)).toEqual({
      costMicros: 0,
      priced: true,
    });
  });

  it("charges cached input at its own price, and the rest at the input price", () => {
    // 600 fresh × $3/M + 400 cached × $0.30/M = 1800 + 120
    expect(cost("anthropic:strong", 1000, 0, 400).costMicros).toBe(1920);
    expect(cost("anthropic:strong", 1000, 0, 1000).costMicros).toBe(300);
    expect(cost("anthropic:strong", 1000, 0, 0).costMicros).toBe(3000);
  });

  it("charges cached input as input when it has no price of its own", () => {
    expect(cost("openai:cheap", 1000, 0, 400).costMicros).toBe(
      cost("openai:cheap", 1000, 0).costMicros
    );
  });

  it("never charges for more cached tokens than there was input", () => {
    expect(cost("anthropic:strong", 1000, 0, 5000).costMicros).toBe(300);
  });

  it("doesn't charge reasoning tokens on top of the output they're part of", () => {
    expect(
      usageCost(prices, "anthropic:strong", {
        inputTokens: 0,
        outputTokens: 500,
        reasoningTokens: 400,
      }).costMicros
    ).toBe(7500);
  });

  it("costs 0 for no usage", () => {
    expect(cost("anthropic:strong", 0, 0, 0)).toEqual({
      costMicros: 0,
      priced: true,
    });
  });

  it("counts nonsense token counts as none rather than throwing", () => {
    expect(cost("anthropic:strong", Number.NaN, -5).costMicros).toBe(0);
    expect(cost("anthropic:strong", 1000.9, 0).costMicros).toBe(3000);
    expect(
      cost("anthropic:strong", Number.POSITIVE_INFINITY, 0).costMicros
    ).toBe(0);
  });

  it("stays exact for very large counts", () => {
    // 2^31 - 1 is the most a usage row's integer column holds.
    const max = 2_147_483_647;
    expect(cost("anthropic:strong", max, max).costMicros).toBe(
      max * 3 + max * 15
    );
    // The products are past 2^53, where a double would drop the half
    // micro-USD that decides the rounding.
    const big: ModelPrices = {
      "test:big": { inputMicros: 1_000_000_000_000, outputMicros: 1 },
    };
    expect(
      usageCost(big, "test:big", { inputTokens: max, outputTokens: 499_999 })
        .costMicros
    ).toBe(2_147_483_647_000_000);
    expect(
      usageCost(big, "test:big", { inputTokens: max, outputTokens: 500_000 })
        .costMicros
    ).toBe(2_147_483_647_000_001);
  });

  it("stops at the largest safe integer", () => {
    const big: ModelPrices = {
      "test:big": {
        inputMicros: 1_000_000_000_000,
        outputMicros: 1_000_000_000_000,
      },
    };
    const { costMicros } = usageCost(big, "test:big", {
      inputTokens: Number.MAX_SAFE_INTEGER,
      outputTokens: Number.MAX_SAFE_INTEGER,
    });
    expect(costMicros).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe("models.prices", () => {
  const providers = {
    anthropic: {},
    openai: {},
  };

  it("ships no prices", () => {
    expect(appConfigSchema.parse({}).models.prices).toEqual({});
  });

  it("takes integer micro-USD per million tokens, by model ref", () => {
    const { models } = appConfigSchema.parse({
      models: {
        prices: {
          "anthropic:claude-x": {
            cachedInputMicros: 300_000,
            inputMicros: 3_000_000,
            outputMicros: 15_000_000,
          },
          "openai:gpt-x": { inputMicros: 150_000, outputMicros: 600_000 },
        },
      },
      providers,
    });
    expect(
      usageCost(models.prices, "anthropic:claude-x", {
        cachedInputTokens: 400,
        inputTokens: 1000,
        outputTokens: 500,
      })
    ).toEqual({ costMicros: 9420, priced: true });
  });

  const rejects = (price: unknown, ref = "openai:gpt-x") =>
    appConfigSchema.safeParse({
      models: { prices: { [ref]: price } },
      providers,
    }).success === false;

  it("rejects fractions, negatives, half a price and unknown keys", () => {
    // $0.15 written in dollars: it has to be 150000.
    expect(rejects({ inputMicros: 0.15, outputMicros: 600_000 })).toBe(true);
    expect(rejects({ inputMicros: -1, outputMicros: 1 })).toBe(true);
    expect(rejects({ inputMicros: 1 })).toBe(true);
    expect(rejects({ input: 1, inputMicros: 1, outputMicros: 1 })).toBe(true);
    expect(rejects({ inputMicros: 1_000_000_000_001, outputMicros: 1 })).toBe(
      true
    );
  });

  it("rejects a price for an alias or an unconfigured provider", () => {
    const price = { inputMicros: 1, outputMicros: 1 };
    expect(rejects(price, "fast")).toBe(true);
    expect(rejects(price, "mistral:large")).toBe(true);
    expect(rejects(price)).toBe(false);
  });

  it("takes a per-image price without token prices (138)", () => {
    expect(rejects({ imageMicros: 40_000 })).toBe(false);
    expect(rejects({ imageMicros: -1 })).toBe(true);
    expect(rejects({})).toBe(true);
  });
});

describe("imageCost", () => {
  const imagePrices: ModelPrices = {
    "openai:gpt-image": {
      imageMicros: 40_000,
      inputMicros: 5_000_000,
      outputMicros: 40_000_000,
    },
    "openai:per-image": { imageMicros: 20_000 },
  };

  it("charges each image, plus its tokens where both are priced", () => {
    expect(imageCost(imagePrices, "openai:per-image", 3)).toEqual({
      costMicros: 60_000,
      priced: true,
    });
    // 2 × $0.04 + 100 × $5/M + 1000 × $40/M = 80000 + 500 + 40000
    expect(
      imageCost(imagePrices, "openai:gpt-image", 2, {
        inputTokens: 100,
        outputTokens: 1000,
      })
    ).toEqual({ costMicros: 120_500, priced: true });
  });

  it("is unpriced for a model `models.prices` doesn't list", () => {
    expect(imageCost(imagePrices, "openai:other", 4)).toEqual({
      costMicros: 0,
      priced: false,
    });
  });

  it("leaves a per-image price's tokens free", () => {
    expect(
      imageCost(imagePrices, "openai:per-image", 1, {
        inputTokens: 10_000,
        outputTokens: 10_000,
      }).costMicros
    ).toBe(20_000);
  });
});
