import { describe, expect, it } from "vitest";
import type { RegistryConfig } from "../providers/registry";

import { describeEvalModel, evalLanguageModel } from "./model";

// Resolving the evals' models from config alone. Building a model makes no
// call: `fetch` here fails loudly if anything tries.

const config = {
  models: {
    aliases: { judge: "local:qwen3", strong: "anthropic:claude-opus-5-5" },
    auto: { cheap: null, enabled: false, strong: null },
    default: "strong",
  },
  providers: {
    anthropic: {
      discover: false,
      discoverTtlSeconds: 3600,
      exclude: [],
      headers: {},
      include: [],
      models: [],
      options: {},
      type: "anthropic",
    },
    keyed: {
      apiKey: "sk-test",
      baseURL: "http://gateway.invalid/v1",
      discover: false,
      discoverTtlSeconds: 3600,
      exclude: [],
      headers: {},
      include: [],
      models: [],
      options: {},
      type: "openai",
    },
    local: {
      baseURL: "http://127.0.0.1:11434/v1",
      discover: false,
      discoverTtlSeconds: 3600,
      exclude: [],
      headers: {},
      include: [],
      models: [],
      options: {},
      type: "openai-compatible",
    },
  },
} as unknown as RegistryConfig;

const noNetwork = (() => {
  throw new Error("no network in tests");
}) as unknown as typeof fetch;

describe("describeEvalModel", () => {
  it("resolves an alias to its provider, endpoint and key state", () => {
    expect(describeEvalModel(config, "judge")).toEqual({
      ok: true,
      value: {
        baseURL: "http://127.0.0.1:11434/v1",
        hasKey: false,
        keyless: true,
        modelId: "qwen3",
        provider: "local",
        ref: "local:qwen3",
        selector: "judge",
        type: "openai-compatible",
      },
    });
    expect(describeEvalModel(config, "keyed:gpt-5")).toMatchObject({
      ok: true,
      value: { hasKey: true, keyless: false, type: "openai" },
    });
  });

  it("names what's wrong with a selector it can't resolve", () => {
    expect(describeEvalModel(config, "nope")).toMatchObject({ ok: false });
    expect(describeEvalModel(config, "missing:model")).toEqual({
      error: `"missing:model" names provider "missing", which isn't under \`providers\``,
      ok: false,
    });
  });
});

describe("evalLanguageModel", () => {
  it("builds a keyless or keyed model without calling anything", () => {
    for (const selector of ["judge", "keyed:gpt-5"]) {
      const target = describeEvalModel(config, selector);
      if (!target.ok) {
        throw new Error(target.error);
      }
      expect(
        evalLanguageModel(config, target.value, { fetch: noNetwork })
      ).toMatchObject({ ok: true });
    }
  });

  it("refuses a keyed provider with no key in the config", () => {
    const target = describeEvalModel(config, "strong");
    if (!target.ok) {
      throw new Error(target.error);
    }
    expect(evalLanguageModel(config, target.value)).toEqual({
      error: 'provider "anthropic" has no apiKey in the config',
      ok: false,
    });
  });
});
