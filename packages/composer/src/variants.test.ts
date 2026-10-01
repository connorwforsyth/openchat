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
  variantChoiceSchema,
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

  it("folds the gateway's -highspeed and -ultraspeed like -fast", () => {
    const folded = foldModelVariants([
      model("gateway:zai/glm-5.3"),
      model("gateway:zai/glm-5.3-highspeed"),
      model("gateway:openai/gpt-5.6-sol"),
      model("gateway:openai/gpt-5.6-sol-ultraspeed"),
      // Only when the base is listed.
      model("gateway:minimax/m3-highspeed"),
    ]);
    expect(folded.models.map((each) => each.selector)).toEqual([
      "gateway:zai/glm-5.3",
      "gateway:openai/gpt-5.6-sol",
      "gateway:minimax/m3-highspeed",
    ]);
    expect(folded.families.get("gateway:zai/glm-5.3")?.fast?.selector).toBe(
      "gateway:zai/glm-5.3-highspeed"
    );
    expect(
      folded.families.get("gateway:openai/gpt-5.6-sol")?.fast?.selector
    ).toBe("gateway:openai/gpt-5.6-sol-ultraspeed");
  });

  it("takes the first listed fast entry when a model has several", () => {
    const folded = foldModelVariants([
      model("gateway:openai/gpt-6"),
      model("gateway:openai/gpt-6-fast"),
      model("gateway:openai/gpt-6-ultraspeed"),
    ]);
    expect(folded.models.map((each) => each.selector)).toEqual([
      "gateway:openai/gpt-6",
    ]);
    expect(folded.families.get("gateway:openai/gpt-6")?.fast?.selector).toBe(
      "gateway:openai/gpt-6-fast"
    );
    // The other still finds the model by search, and maps back to it.
    expect(folded.baseOf.get("gateway:openai/gpt-6-ultraspeed")).toBe(
      "gateway:openai/gpt-6"
    );
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

describe("providerLevels and providerFastTier", () => {
  it("read the server's tables, for models the server says reason", () => {
    expect(providerLevels(model("openai:gpt-6"), "openai")).toBeUndefined();
    expect(
      providerLevels(
        model("gateway:anthropic/claude-opus-5.5", reasons),
        "anthropic"
      )
    ).toEqual(["low", "medium", "high", "xhigh"]);
    expect(providerFastTier(model("openai:gpt-5.2"), "openai")).toBe(true);
    expect(providerFastTier(model("acme:m"), "acme")).toBe(false);
  });
});

describe("thinkingLevels", () => {
  it("offers nothing for a model that doesn't reason and has no thinking entry", () => {
    expect(
      thinkingLevels(
        familyFor([model("acme:m")], "acme:m"),
        "acme",
        false,
        true
      )
    ).toBeUndefined();
  });

  it("makes a folded entry the level that picks it, over the provider's", () => {
    const models = [
      model("openai:o4-mini", reasons),
      model("openai:o4-mini-high", reasons),
    ];
    const family = familyFor(models, "openai:o4-mini");
    expect(thinkingLevels(family, "openai", false, true)).toEqual([
      { level: "low" },
      { default: true, level: "medium" },
      { level: "high", model: models[1] },
    ]);
  });

  it("is off or on for a model whose only thinking is a catalog entry", () => {
    const models = [model("acme:q"), model("acme:q:thinking")];
    expect(
      thinkingLevels(familyFor(models, "acme:q"), "acme", false, true)
    ).toEqual([
      { default: true, level: "off" },
      { level: "on", model: models[1] },
    ]);
  });

  it("marks what can't be had: fast mode, a missing key, a host without run options", () => {
    const models = [
      model("acme:q"),
      model("acme:q-thinking", { available: false }),
      model("acme:q-high"),
      model("acme:q-fast"),
    ];
    const family = familyFor(models, "acme:q");
    expect(thinkingLevels(family, "acme", false, true)).toEqual([
      { default: true, level: "off" },
      { blocked: "unavailable", level: "on", model: models[1] },
      { level: "high", model: models[2] },
    ]);
    expect(
      thinkingLevels(family, "acme", true, true)?.map((each) => each.blocked)
    ).toEqual([undefined, "fast", "fast"]);
    const gpt6 = familyFor([model("openai:gpt-6", reasons)], "openai:gpt-6");
    expect(
      thinkingLevels(gpt6, "openai", false, false)?.map((each) => each.blocked)
    ).toEqual(["server", undefined, "server", "server"]);
    expect(
      thinkingLevels(gpt6, "openai", false, true)?.every(
        (each) => each.blocked === undefined
      )
    ).toBe(true);
  });
});

describe("variantChoiceSchema", () => {
  it("reads a level remembered as the old Default as none chosen", () => {
    expect(
      variantChoiceSchema.parse({ fast: false, level: "default" })
    ).toEqual({ fast: false });
  });
});

describe("fastMode", () => {
  it("is a folded entry, else the provider's tier when the host sends options", () => {
    const models = [
      model("gateway:anthropic/claude-opus-5"),
      model("gateway:anthropic/claude-opus-5-fast"),
      model("openai:gpt-5.2"),
      model("acme:m"),
    ];
    expect(
      fastMode(
        familyFor(models, "gateway:anthropic/claude-opus-5"),
        "anthropic",
        true
      )
    ).toEqual({ model: models[1] });
    const gpt = familyFor(models, "openai:gpt-5.2");
    expect(fastMode(gpt, "openai", true)).toEqual({});
    expect(fastMode(gpt, "openai", false)).toEqual({ blocked: "server" });
    expect(fastMode(familyFor(models, "acme:m"), "acme", true)).toBeUndefined();
  });
});

describe("targetForChoice and choiceOfTarget", () => {
  const models = [
    model("openai:o4-mini", reasons),
    model("openai:o4-mini-high", reasons),
    model("openai:o4-mini-fast", reasons),
  ];
  const family = familyFor(models, "openai:o4-mini");
  const o4 = { model: "openai:o4-mini", type: "model" } as const;

  it("sends a provider level as the run's reasoning, not on the target", () => {
    const made = targetForChoice(
      family,
      "openai",
      { fast: false, level: "low" },
      true
    );
    expect(made).toEqual({ target: o4, variant: { reasoning: "low" } });
    expect(choiceOfTarget(family, made.target, made.variant)).toEqual({
      fast: false,
      level: "low",
    });
  });

  it("picks a folded entry for its level, and the fast entry for fast mode", () => {
    const high = targetForChoice(
      family,
      "openai",
      { fast: false, level: "high" },
      true
    );
    expect(high).toEqual({
      target: { model: "openai:o4-mini-high", type: "model" },
      variant: {},
    });
    expect(choiceOfTarget(family, high.target, high.variant)).toEqual({
      fast: false,
      level: "high",
    });
    // Fast mode wins; the folded level waits until it's off.
    expect(
      targetForChoice(family, "openai", { fast: true, level: "high" }, true)
    ).toEqual({
      target: { model: "openai:o4-mini-fast", type: "model" },
      variant: {},
    });
    expect(
      targetForChoice(family, "openai", { fast: true, level: "low" }, true)
    ).toEqual({
      target: { model: "openai:o4-mini-fast", type: "model" },
      variant: { reasoning: "low" },
    });
  });

  it("asks for a provider's fast tier as the run's fast option", () => {
    const gpt = familyFor([model("openai:gpt-5.2", reasons)], "openai:gpt-5.2");
    const made = targetForChoice(
      gpt,
      "openai",
      { fast: true, level: "low" },
      true
    );
    expect(made).toEqual({
      target: { model: "openai:gpt-5.2", type: "model" },
      variant: { fast: true, reasoning: "low" },
    });
    expect(choiceOfTarget(gpt, made.target, made.variant)).toEqual({
      fast: true,
      level: "low",
    });
  });

  it("sends nothing for the provider's default, or what the host can't send", () => {
    expect(targetForChoice(family, "openai", { fast: false }, true)).toEqual({
      target: o4,
      variant: {},
    });
    // Medium is what o4-mini does with nothing sent (113).
    expect(
      targetForChoice(family, "openai", { fast: false, level: "medium" }, true)
    ).toEqual({ target: o4, variant: {} });
    expect(
      targetForChoice(family, "openai", { fast: false, level: "low" }, false)
    ).toEqual({ target: o4, variant: {} });
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
