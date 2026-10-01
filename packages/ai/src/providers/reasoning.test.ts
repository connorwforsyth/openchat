import { generateText } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";

import { generated } from "../testing/mock-models";
import { hasFastTier, identityOf, reasoningLevels } from "./reasoning";
import { runSettings, withRunSettings } from "./run-settings";

const levels = (vendor: string, modelId: string) =>
  reasoningLevels({ modelId, vendor });

describe("reasoningLevels", () => {
  it("follows each provider's SDK mapping", () => {
    expect(levels("anthropic", "claude-sonnet-4-5")).toEqual([
      "off",
      "low",
      "medium",
      "high",
    ]);
    expect(levels("anthropic", "claude-opus-5")).toEqual([
      "off",
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
    // Always thinks: no off. A gateway's `vendor/` prefix and dots don't matter.
    expect(levels("anthropic", "anthropic/claude-opus-5.5")).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
    expect(levels("openai", "o3")).toEqual(["low", "medium", "high"]);
    expect(levels("openai", "gpt-5")).toEqual([
      "minimal",
      "low",
      "medium",
      "high",
    ]);
    expect(levels("openai", "gpt-5.2")).toEqual([
      "off",
      "low",
      "medium",
      "high",
    ]);
    expect(levels("openai", "gpt-6")).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
    expect(levels("openai", "gpt-6-sol")).toEqual([
      "off",
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
    expect(levels("google", "gemini-2.5-flash")).toEqual([
      "off",
      "low",
      "medium",
      "high",
    ]);
    expect(levels("google", "gemini-2.5-pro")).toEqual([
      "low",
      "medium",
      "high",
    ]);
    expect(levels("google", "gemini-3-pro")).toEqual([
      "minimal",
      "low",
      "medium",
      "high",
    ]);
    expect(levels("deepseek", "deepseek-v4")).toEqual(["off", "low", "high"]);
    expect(levels("qwen", "qwen3-235b")).toEqual(["low", "medium", "high"]);
  });
});

describe("identityOf", () => {
  it("names the maker the way the picker does", () => {
    expect(identityOf("gateway:anthropic/claude-opus-5.5")).toEqual({
      modelId: "anthropic/claude-opus-5.5",
      vendor: "anthropic",
    });
    expect(identityOf("openai:o3")).toEqual({
      modelId: "o3",
      vendor: "openai",
    });
  });
});

describe("hasFastTier", () => {
  it("follows the SDKs' gates", () => {
    const fast = (vendor: string, modelId: string) =>
      hasFastTier({ modelId, vendor });
    expect(fast("openai", "gpt-5.2")).toBe(true);
    expect(fast("openai", "o3")).toBe(true);
    expect(fast("openai", "gpt-4o")).toBe(true);
    expect(fast("openai", "gpt-5-nano")).toBe(false);
    expect(fast("openai", "gpt-5-chat-latest")).toBe(false);
    expect(fast("anthropic", "claude-opus-4-6")).toBe(true);
    expect(fast("anthropic", "claude-haiku-5")).toBe(false);
    expect(fast("google", "gemini-3-pro")).toBe(false);
  });
});

describe("runSettings", () => {
  const settings = (
    providerType: Parameters<typeof runSettings>[0]["providerType"],
    vendor: string,
    modelId: string,
    options: Parameters<typeof runSettings>[0]["options"],
    reasons?: boolean
  ) => runSettings({ modelId, options, providerType, reasons, vendor });

  it("maps a level to the SDK's reasoning setting, off to none", () => {
    expect(
      settings("anthropic", "anthropic", "claude-opus-5", {
        reasoning: "xhigh",
      })
    ).toEqual({ reasoning: "xhigh" });
    expect(
      settings("anthropic", "anthropic", "claude-sonnet-4-5", {
        reasoning: "off",
      })
    ).toEqual({ reasoning: "none" });
    expect(
      settings("openai", "openai", "gpt-5", { reasoning: "minimal" })
    ).toEqual({ reasoning: "minimal" });
    expect(
      settings("google", "google", "gemini-2.5-flash", { reasoning: "low" })
    ).toEqual({ reasoning: "low" });
    // The older field still works, and `reasoning` wins over it.
    expect(
      settings("openai", "openai", "o3", { reasoningEffort: "high" })
    ).toEqual({ reasoning: "high" });
    expect(
      settings("openai", "openai", "o3", {
        reasoning: "low",
        reasoningEffort: "high",
      })
    ).toEqual({ reasoning: "low" });
  });

  it("drops a level the model doesn't take", () => {
    expect(
      settings("anthropic", "anthropic", "claude-opus-5-5", {
        reasoning: "off",
      })
    ).toEqual({});
    expect(settings("openai", "openai", "o3", { reasoning: "xhigh" })).toEqual(
      {}
    );
    expect(
      settings("google", "google", "gemini-3-pro", { reasoning: "off" })
    ).toEqual({});
  });

  it("passes a level to an OpenAI-compatible server only where its catalog says it reasons", () => {
    expect(
      settings("openai-compatible", "mock", "echo", { reasoning: "low" }, true)
    ).toEqual({ reasoning: "low" });
    expect(
      settings("openai-compatible", "mock", "echo", { reasoning: "low" })
    ).toEqual({});
    expect(
      settings("openai-compatible", "mock", "echo", { reasoning: "low" }, false)
    ).toEqual({});
  });

  it("asks for the fast tier only where the model has one", () => {
    expect(settings("openai", "openai", "gpt-5.2", { fast: true })).toEqual({
      providerOptions: { openai: { serviceTier: "priority" } },
    });
    expect(
      settings("anthropic", "anthropic", "claude-opus-4-6", { fast: true })
    ).toEqual({ providerOptions: { anthropic: { speed: "fast" } } });
    expect(settings("openai", "openai", "gpt-5-nano", { fast: true })).toEqual(
      {}
    );
    // A gateway lists its fast models separately; Azure and Bedrock aren't gated.
    expect(
      settings("openai-compatible", "anthropic", "anthropic/claude-opus-4.6", {
        fast: true,
      })
    ).toEqual({});
    expect(settings("azure", "openai", "gpt-5.2", { fast: true })).toEqual({});
    expect(settings("openai", "openai", "gpt-5.2", { fast: false })).toEqual(
      {}
    );
  });
});

describe("withRunSettings", () => {
  it("adds the level and merges provider options into every call", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: generated([{ text: "ok", type: "text" }]),
    });
    await generateText({
      model: withRunSettings(model, {
        providerOptions: { openai: { serviceTier: "priority" } },
        reasoning: "low",
      }),
      prompt: "hi",
      providerOptions: { openai: { user: "u1" }, other: { x: 1 } },
      reasoning: "high",
    });
    const [call] = model.doGenerateCalls;
    expect(call?.reasoning).toBe("low");
    expect(call?.providerOptions).toEqual({
      openai: { serviceTier: "priority", user: "u1" },
      other: { x: 1 },
    });
  });

  it("leaves the model alone when there's nothing to add", () => {
    const model = new MockLanguageModelV4();
    expect(withRunSettings(model, {})).toBe(model);
  });
});
