import { type AppConfigInput, appConfigSchema } from "@workspace/config/schema";
import type { ModelOption } from "@workspace/contract/schemas/models";
import { describe, expect, it } from "vitest";

import type { ProviderCredentials } from "../ports/provider-registry";
import { buildRegistry, withImageModel } from "./registry";

// Image models (138) against a canned catalog: they're their own list for
// `generate_image`, and never reach the chat picker. Every `fetch` is fake.

const key = (provider: string): ProviderCredentials => ({
  apiKey: "test-key-not-real",
  provider,
  source: { type: "instance" },
});

const CATALOG = {
  data: [
    { id: "anthropic/claude-haiku-4.5", type: "language" },
    {
      architecture: { output_modalities: ["text", "image"] },
      id: "google/gemini-2.5-flash-image",
      type: "language",
    },
    { id: "openai/gpt-image-1", name: "GPT Image 1", type: "image" },
    { id: "bfl/flux-pro", type: "image" },
  ],
};

const fetch = (() =>
  Promise.resolve(
    new Response(JSON.stringify(CATALOG), { status: 200 })
  )) as unknown as typeof globalThis.fetch;

const config = (image: Record<string, unknown>): AppConfigInput => ({
  models: { image },
  providers: {
    gateway: {
      baseURL: "https://gateway.example/v1",
      discover: true,
      options: { keyless: "false" },
      type: "openai-compatible",
    },
    openai: { type: "openai" },
  },
});

const build = (input: AppConfigInput) =>
  buildRegistry(appConfigSchema.parse(input), { fetch });

const keys = { gateway: key("gateway") };

describe("image models", () => {
  it("never reach the chat picker, and only run as image models", async () => {
    const registry = build(config({}));
    const listed = (await registry.listModels(keys)).map(
      (option) => option.selector
    );
    expect(listed).toEqual([
      "gateway:anthropic/claude-haiku-4.5",
      "gateway:google/gemini-2.5-flash-image",
    ]);
    expect(
      (await registry.checkModel("gateway:openai/gpt-image-1", keys.gateway)).ok
    ).toBe(false);
  });

  it("are the default, then the configured ones, then discovered ones when asked", async () => {
    const registry = build(
      config({
        default: "openai:gpt-image-1",
        discover: true,
        models: ["gateway:openai/gpt-image-1"],
      })
    );
    expect(await registry.imageModels(keys)).toEqual([
      // No OpenAI key in this context; no catalog names it, so it's tidied.
      {
        available: false,
        displayName: "GPT-Image 1",
        target: "openai:gpt-image-1",
      },
      {
        available: true,
        displayName: "GPT Image 1",
        target: "gateway:openai/gpt-image-1",
      },
      {
        available: true,
        displayName: "Flux Pro",
        target: "gateway:bfl/flux-pro",
      },
    ]);
  });

  it("leave discovered ones out unless `discover` is on", async () => {
    const registry = build(config({ default: "openai:gpt-image-1" }));
    expect(
      (await registry.imageModels(keys)).map((model) => model.target)
    ).toEqual(["openai:gpt-image-1"]);
  });

  it("tell each tool-calling chat model which image model it would use", async () => {
    const registry = build(
      config({ discover: true, models: ["gateway:openai/gpt-image-1"] })
    );
    const options = await registry.listModels(keys);
    expect(options.map((option) => option.imageModel)).toEqual([
      { displayName: "GPT Image 1", target: "gateway:openai/gpt-image-1" },
      { displayName: "GPT Image 1", target: "gateway:openai/gpt-image-1" },
    ]);
  });

  it("mark a chat model the catalog says draws images itself", async () => {
    const registry = build(config({}));
    const [haiku, gemini] = await registry.listModels(keys);
    expect(haiku?.capabilities).not.toContain("image-output");
    expect(gemini?.capabilities).toContain("image-output");
  });

  it("build an AI SDK image model for a native or compatible provider", () => {
    const registry = build(config({}));
    expect(
      registry.imageModel("gateway:openai/gpt-image-1", keys.gateway).ok
    ).toBe(true);
    expect(registry.imageModel("openai:gpt-image-1", undefined)).toEqual({
      error: { provider: "openai", type: "missing_key" },
      ok: false,
    });
  });
});

describe("withImageModel", () => {
  const option = (overrides: Partial<ModelOption>): ModelOption => ({
    available: true,
    capabilities: ["tools"],
    contextWindow: null,
    label: "m",
    selector: "x:m",
    target: "x:m",
    ...overrides,
  });

  it("names the first available image model, only for models that call tools", () => {
    const images = [
      { available: false, displayName: "A", target: "x:a" },
      { available: true, displayName: "B", target: "x:b" },
    ];
    expect(
      withImageModel(
        [option({}), option({ capabilities: [] }), option({ target: null })],
        images
      ).map((entry) => entry.imageModel)
    ).toEqual([{ displayName: "B", target: "x:b" }, undefined, undefined]);
    expect(withImageModel([option({})], [])[0]?.imageModel).toBeUndefined();
  });
});
