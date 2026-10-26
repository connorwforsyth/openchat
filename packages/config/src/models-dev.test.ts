import { describe, expect, it } from "vitest";

import {
  MODELS_DEV_URL,
  modelsDevSchema,
  priceSnapshotSchema,
  snapshotFromModelsDev,
} from "./models-dev";
import snapshotJson from "./models-dev.snapshot.json";

const provider = (models: Record<string, unknown>) => ({
  id: "x",
  models,
  name: "X",
});

const catalog = modelsDevSchema.parse({
  anthropic: provider({
    "claude-a": { cost: { input: 3, output: 15 } },
    "claude-b": { cost: { cache_read: 0.01, input: 0.1, output: 0.5 } },
    "claude-free": { cost: { input: 0, output: 0 } },
    "claude-unlisted": { name: "No cost given" },
  }),
  google: provider({}),
  openai: provider({ "gpt-x": { cost: { input: 0.075, output: 0.3 } } }),
  "some-other-provider": provider({ m: { cost: { input: 1, output: 1 } } }),
  vercel: provider({
    "anthropic/claude-b": {
      cost: {
        cache_read: 0.01,
        cache_write: 0.125,
        input: 0.1,
        output: 0.5,
        tiers: [
          { input: 0.5, output: 2.5, tier: { size: 100_000, type: "context" } },
        ],
      },
    },
  }),
});

describe("snapshotFromModelsDev", () => {
  const snapshot = snapshotFromModelsDev(catalog, "2026-10-26T00:00:00.000Z");

  it("converts USD per million tokens to integer micro-USD", () => {
    expect(snapshot.prices.anthropic["claude-b"]).toEqual({
      cachedInputMicros: 10_000,
      inputMicros: 100_000,
      outputMicros: 500_000,
    });
    expect(snapshot.prices.openai["gpt-x"]).toEqual({
      inputMicros: 75_000,
      outputMicros: 300_000,
    });
  });

  it("keeps free models and leaves out ones with no price", () => {
    expect(snapshot.prices.anthropic["claude-free"]).toEqual({
      inputMicros: 0,
      outputMicros: 0,
    });
    expect(snapshot.prices.anthropic).not.toHaveProperty("claude-unlisted");
  });

  it("keeps only the sources we price, at their base rate", () => {
    expect(Object.keys(snapshot.prices)).toEqual([
      "anthropic",
      "google",
      "openai",
      "vercel",
    ]);
    expect(snapshot.prices.vercel["anthropic/claude-b"]).toEqual(
      snapshot.prices.anthropic["claude-b"]
    );
  });

  it("sorts models by id so a refresh diffs cleanly", () => {
    expect(Object.keys(snapshot.prices.anthropic)).toEqual([
      "claude-a",
      "claude-b",
      "claude-free",
    ]);
  });

  it("is a valid snapshot", () => {
    expect(priceSnapshotSchema.parse(snapshot)).toEqual(snapshot);
  });
});

describe("the committed snapshot", () => {
  const snapshot = priceSnapshotSchema.parse(snapshotJson);

  it("comes from models.dev and prices every source", () => {
    expect(snapshot.source).toBe(MODELS_DEV_URL);
    for (const models of Object.values(snapshot.prices)) {
      expect(Object.keys(models).length).toBeGreaterThan(0);
    }
  });

  it("prices the model the instance runs on", () => {
    expect(snapshot.prices.anthropic["claude-haiku-5-5"]).toMatchObject({
      inputMicros: expect.any(Number),
      outputMicros: expect.any(Number),
    });
  });
});
