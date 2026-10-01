import type { ModelOption } from "@workspace/contract/schemas/models";
import { describe, expect, it } from "vitest";

import {
  buildTargetGroups,
  filterTargetGroups,
  findTargetChoice,
} from "./options";
import {
  choiceOfTarget,
  fastMode,
  foldModelVariants,
  type ModelFamily,
  providerFastTier,
  providerLevels,
  targetForChoice,
  thinkingLevels,
} from "./variants";

const model = (
  selector: string,
  extra: Partial<ModelOption> = {}
): ModelOption => ({
  available: true,
  capabilities: [],
  contextWindow: null,
  label: selector,
  selector,
  target: selector.includes(":") ? selector : null,
  ...extra,
});

const reasons = { capabilities: ["reasoning" as const] };

const familyFor = (
  models: readonly ModelOption[],
  selector: string
): ModelFamily => {
  const family = foldModelVariants(models).families.get(selector);
  if (!family) {
    throw new Error(`no family for ${selector}`);
  }
  return family;
};

describe("foldModelVariants", () => {
  it("folds a mode of a listed model into it", () => {
    const folded = foldModelVariants([
      model("openai:o4-mini"),
      model("openai:o4-mini-high"),
      model("openrouter:anthropic/claude-3.7-sonnet"),
      model("openrouter:anthropic/claude-3.7-sonnet:thinking"),
      model("acme:qwen3-235b"),
      model("acme:qwen3-235b-thinking"),
      model("acme:grok-5"),
      model("acme:grok-5-reasoning"),
      model("gateway:anthropic/claude-opus-5"),
      model("gateway:anthropic/claude-opus-5-fast"),
      model("acme:kimi-k3"),
      model("acme:kimi-k3-turbo"),
      model("acme:gpt-7"),
      model("acme:gpt-7-instant"),
    ]);
    expect(folded.models.map((each) => each.selector)).toEqual([
      "openai:o4-mini",
      "openrouter:anthropic/claude-3.7-sonnet",
      "acme:qwen3-235b",
      "acme:grok-5",
      "gateway:anthropic/claude-opus-5",
      "acme:kimi-k3",
      "acme:gpt-7",
    ]);
    const o4 = folded.families.get("openai:o4-mini");
    expect(o4?.thinking.map((each) => each.level)).toEqual(["high"]);
    expect(
      folded.families.get("openrouter:anthropic/claude-3.7-sonnet")?.thinking
    ).toEqual([
      {
        level: "on",
        model: model("openrouter:anthropic/claude-3.7-sonnet:thinking"),
      },
    ]);
    expect(
      folded.families.get("gateway:anthropic/claude-opus-5")?.fast?.selector
    ).toBe("gateway:anthropic/claude-opus-5-fast");
    expect(folded.families.get("acme:kimi-k3")?.fast?.selector).toBe(
      "acme:kimi-k3-turbo"
    );
    expect(folded.families.get("acme:gpt-7")?.fast?.selector).toBe(
      "acme:gpt-7-instant"
    );
    expect(folded.baseOf.get("openai:o4-mini-high")).toBe("openai:o4-mini");
  });

  it("keeps other models apart: minis, nanos, sizes, and a mode without its base", () => {
    const models = [
      model("openai:gpt-6"),
      model("openai:gpt-6-mini"),
      model("openai:gpt-6-nano"),
      model("acme:llama-4-70b"),
      model("acme:llama-4-8b"),
      // No `openai:o3` listed: it stays a row of its own.
      model("openai:o3-high"),
      // A different provider key is a different model.
      model("other:gpt-6-fast"),
    ];
    const folded = foldModelVariants(models);
    expect(folded.models).toEqual(models);
    expect(folded.baseOf.size).toBe(0);
  });

  it("never folds an alias, nor into a mode that's itself folded", () => {
    const folded = foldModelVariants([
      model("fast"),
      model("strong-fast"),
      model("strong"),
      model("acme:m"),
      model("acme:m-fast"),
      model("acme:m-fast-thinking"),
    ]);
    expect(folded.models.map((each) => each.selector)).toEqual([
      "fast",
      "strong-fast",
      "strong",
      "acme:m",
      "acme:m-fast-thinking",
    ]);
  });
});

describe("providerLevels", () => {
  const levels = (selector: string, vendor: string) =>
    providerLevels(model(selector, reasons), vendor)?.map((each) =>
      each.needsServer ? `${each.level}*` : each.level
    );

  it("is only for models the server says reason", () => {
    expect(providerLevels(model("openai:gpt-6"), "openai")).toBeUndefined();
  });

  it("follows each provider's SDK; * needs a wider contract", () => {
    expect(levels("anthropic:claude-sonnet-4-5", "anthropic")).toEqual([
      "off",
      "low",
      "medium",
      "high",
    ]);
    expect(levels("anthropic:claude-opus-5", "anthropic")).toEqual([
      "off",
      "low",
      "medium",
      "high",
      "xhigh*",
      "max*",
    ]);
    // Always thinks: no off.
    expect(levels("gateway:anthropic/claude-opus-5.5", "anthropic")).toEqual([
      "low",
      "medium",
      "high",
      "xhigh*",
      "max*",
    ]);
    expect(levels("openai:o3", "openai")).toEqual(["low", "medium", "high"]);
    expect(levels("openai:gpt-5", "openai")).toEqual([
      "minimal*",
      "low",
      "medium",
      "high",
    ]);
    expect(levels("openai:gpt-5.2", "openai")).toEqual([
      "off",
      "low",
      "medium",
      "high",
    ]);
    expect(levels("openai:gpt-6-sol", "openai")).toEqual([
      "off",
      "low",
      "medium",
      "high",
      "xhigh*",
      "max*",
    ]);
    expect(levels("google:gemini-2.5-flash", "google")).toEqual([
      "off",
      "low",
      "medium",
      "high",
    ]);
    expect(levels("google:gemini-2.5-pro", "google")).toEqual([
      "low",
      "medium",
      "high",
    ]);
    expect(levels("google:gemini-3-pro", "google")).toEqual([
      "minimal*",
      "low",
      "medium",
      "high",
    ]);
    expect(levels("deepseek:deepseek-v4", "deepseek")).toEqual([
      "off",
      "low",
      "high",
      "max*",
    ]);
    expect(levels("local:qwen3", "qwen")).toEqual(["low", "medium", "high"]);
  });
});

describe("providerFastTier", () => {
  it("follows the SDKs' gates", () => {
    const fast = (selector: string, vendor: string) =>
      providerFastTier(model(selector), vendor);
    expect(fast("openai:gpt-5.2", "openai")).toBe(true);
    expect(fast("openai:o3", "openai")).toBe(true);
    expect(fast("openai:gpt-4o", "openai")).toBe(true);
    expect(fast("openai:gpt-5-nano", "openai")).toBe(false);
    expect(fast("openai:gpt-5-chat-latest", "openai")).toBe(false);
    expect(fast("anthropic:claude-opus-4-6", "anthropic")).toBe(true);
    expect(fast("anthropic:claude-haiku-5", "anthropic")).toBe(false);
    expect(fast("google:gemini-3-pro", "google")).toBe(false);
  });
});

describe("thinkingLevels", () => {
  it("offers nothing for a model that doesn't reason and has no thinking entry", () => {
    expect(
      thinkingLevels(familyFor([model("acme:m")], "acme:m"), "acme", false)
    ).toBeUndefined();
  });

  it("makes a folded entry the level that picks it, over the provider's", () => {
    const models = [
      model("openai:o4-mini", reasons),
      model("openai:o4-mini-high", reasons),
    ];
    const family = familyFor(models, "openai:o4-mini");
    expect(thinkingLevels(family, "openai", false)).toEqual([
      { level: "default" },
      { level: "low" },
      { level: "medium" },
      { level: "high", model: models[1] },
    ]);
  });

  it("is off or on for a model whose only thinking is a catalog entry", () => {
    const models = [model("acme:q"), model("acme:q:thinking")];
    expect(thinkingLevels(familyFor(models, "acme:q"), "acme", false)).toEqual([
      { level: "off" },
      { level: "on", model: models[1] },
    ]);
  });

  it("marks what can't be had: server support, fast mode, a missing key", () => {
    const models = [
      model("acme:q"),
      model("acme:q-thinking", { available: false }),
      model("acme:q-high"),
      model("acme:q-fast"),
    ];
    const family = familyFor(models, "acme:q");
    expect(thinkingLevels(family, "acme", false)).toEqual([
      { level: "off" },
      { blocked: "unavailable", level: "on", model: models[1] },
      { level: "high", model: models[2] },
    ]);
    expect(
      thinkingLevels(family, "acme", true)?.map((each) => each.blocked)
    ).toEqual([undefined, "fast", "fast"]);
    expect(
      thinkingLevels(
        familyFor([model("openai:gpt-6", reasons)], "openai:gpt-6"),
        "openai",
        false
      )?.filter((each) => each.blocked === "server")
    ).toEqual([
      { blocked: "server", level: "xhigh" },
      { blocked: "server", level: "max" },
    ]);
  });
});

describe("fastMode", () => {
  it("is a folded entry, else the provider's tier (which needs the server)", () => {
    const models = [
      model("gateway:anthropic/claude-opus-5"),
      model("gateway:anthropic/claude-opus-5-fast"),
      model("openai:gpt-5.2"),
      model("acme:m"),
    ];
    expect(
      fastMode(
        familyFor(models, "gateway:anthropic/claude-opus-5"),
        "anthropic"
      )
    ).toEqual({ model: models[1] });
    expect(fastMode(familyFor(models, "openai:gpt-5.2"), "openai")).toEqual({
      blocked: "server",
    });
    expect(fastMode(familyFor(models, "acme:m"), "acme")).toBeUndefined();
  });
});

describe("targetForChoice and choiceOfTarget", () => {
  const models = [
    model("openai:o4-mini", reasons),
    model("openai:o4-mini-high", reasons),
    model("openai:o4-mini-fast", reasons),
  ];
  const family = familyFor(models, "openai:o4-mini");

  it("sends a level the contract has as the target's reasoningEffort", () => {
    const target = targetForChoice(family, "openai", {
      fast: false,
      level: "low",
    });
    expect(target).toEqual({
      model: "openai:o4-mini",
      parameters: { reasoningEffort: "low" },
      type: "model",
    });
    expect(choiceOfTarget(family, target)).toEqual({
      fast: false,
      level: "low",
    });
  });

  it("picks a folded entry for its level, and the fast entry for fast mode", () => {
    const high = targetForChoice(family, "openai", {
      fast: false,
      level: "high",
    });
    expect(high).toEqual({ model: "openai:o4-mini-high", type: "model" });
    expect(choiceOfTarget(family, high)).toEqual({
      fast: false,
      level: "high",
    });
    // Fast mode wins; the folded level waits until it's off.
    const fast = targetForChoice(family, "openai", {
      fast: true,
      level: "high",
    });
    expect(fast).toEqual({ model: "openai:o4-mini-fast", type: "model" });
    expect(
      targetForChoice(family, "openai", { fast: true, level: "medium" })
    ).toEqual({
      model: "openai:o4-mini-fast",
      parameters: { reasoningEffort: "medium" },
      type: "model",
    });
  });

  it("sends nothing for the default, or a level it can't send yet", () => {
    expect(
      targetForChoice(family, "openai", { fast: false, level: "default" })
    ).toEqual({ model: "openai:o4-mini", type: "model" });
    const gpt6 = familyFor([model("openai:gpt-6", reasons)], "openai:gpt-6");
    expect(
      targetForChoice(gpt6, "openai", { fast: false, level: "xhigh" })
    ).toEqual({ model: "openai:gpt-6", type: "model" });
  });
});

describe("the picker's list (105)", () => {
  const models = [
    model("openai:o4-mini", { ...reasons, displayName: "o4-mini" }),
    model("openai:o4-mini-high", { ...reasons, displayName: "o4-mini (high)" }),
    model("openai:gpt-6-mini"),
  ];

  it("lists a model once, finds it by a folded entry, and checks it for one", () => {
    const groups = buildTargetGroups(models, []);
    expect(groups.providers[0]?.choices.map((choice) => choice.target)).toEqual(
      [
        { model: "openai:o4-mini", type: "model" },
        { model: "openai:gpt-6-mini", type: "model" },
      ]
    );
    const found = filterTargetGroups(groups, "o4-mini-high", "Auto");
    expect(found.providers[0]?.choices.map((choice) => choice.label)).toEqual([
      "o4-mini",
    ]);
    expect(
      findTargetChoice(groups, { model: "openai:o4-mini-high", type: "model" })
        ?.label
    ).toBe("o4-mini");
  });
});
