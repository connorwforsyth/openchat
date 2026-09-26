import { appConfigSchema } from "@workspace/config/schema";
import { APICallError } from "ai";
import { MockEmbeddingModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";

import { buildRegistry } from "../providers/registry";
import {
  createAiSdkEmbedder,
  createEmbedder,
  knownDimensions,
  toEmbedderError,
} from "./embedder";
import { createHashEmbeddingModel } from "./mock-embedding-model";

describe("createAiSdkEmbedder", () => {
  it("embeds through embedMany, splitting at the model's limit", async () => {
    const model = createHashEmbeddingModel({
      dimensions: 8,
      maxEmbeddingsPerCall: 2,
    });
    const embedder = createAiSdkEmbedder({
      dimensions: 8,
      model,
      ref: "test:hash",
    });
    const result = await embedder.embed(["a", "b", "c"]);
    expect(result.ok && result.value.embeddings.map((v) => v.length)).toEqual([
      8, 8, 8,
    ]);
    expect(model.doEmbedCalls.map((call) => call.values)).toEqual([
      ["a", "b"],
      ["c"],
    ]);
    expect(embedder).toMatchObject({ dimensions: 8, model: "test:hash" });
    expect(await embedder.embed([])).toEqual({
      ok: true,
      value: { embeddings: [], usage: { tokens: 0 } },
    });
  });

  it("refuses vectors of the wrong size", async () => {
    const embedder = createAiSdkEmbedder({
      dimensions: 16,
      model: createHashEmbeddingModel({ dimensions: 8 }),
      ref: "test:hash",
    });
    expect(await embedder.embed(["a"])).toMatchObject({
      error: { type: "unavailable" },
      ok: false,
    });
  });

  it("maps provider failures to port errors without echoing the body", async () => {
    const failing = (statusCode: number, headers?: Record<string, string>) =>
      new MockEmbeddingModelV4({
        doEmbed: () => {
          throw new APICallError({
            isRetryable: false,
            message: "secret-ish provider text",
            requestBodyValues: {},
            responseHeaders: headers,
            statusCode,
            url: "https://example.test",
          });
        },
      });
    const embedder = (statusCode: number, headers?: Record<string, string>) =>
      createAiSdkEmbedder({
        dimensions: 8,
        maxRetries: 0,
        model: failing(statusCode, headers),
        ref: "test:x",
      });
    expect(await embedder(429, { "retry-after": "7" }).embed(["a"])).toEqual({
      error: { retryAfterSeconds: 7, type: "rate_limited" },
      ok: false,
    });
    const down = await embedder(503).embed(["a"]);
    expect(down).toEqual({
      error: {
        message: "The embedding provider answered 503.",
        type: "unavailable",
      },
      ok: false,
    });
    expect(toEmbedderError(new Error("boom"))).toEqual({
      message: "Embedding failed.",
      type: "unavailable",
    });
  });
});

describe("createEmbedder", () => {
  const config = (embeddings: object) =>
    appConfigSchema.parse({
      embeddings,
      providers: {
        ollama: {
          baseURL: "http://localhost:11434/v1",
          type: "openai-compatible",
        },
      },
    });

  it("is off without an embeddings model, the default", () => {
    const registry = buildRegistry(config({}));
    expect(createEmbedder(config({}), { keys: {}, registry })).toEqual({
      error: { type: "not_configured" },
      ok: false,
    });
  });

  it("knows common model sizes and asks for the rest", () => {
    expect(knownDimensions("ollama:nomic-embed-text:latest")).toBe(768);
    expect(knownDimensions("openai:text-embedding-3-small")).toBe(1536);
    const known = config({ model: "ollama:nomic-embed-text" });
    const embedder = createEmbedder(known, {
      keys: {},
      registry: buildRegistry(known),
    });
    expect(embedder.ok && embedder.value).toMatchObject({
      dimensions: 768,
      model: "ollama:nomic-embed-text",
    });

    const unknown = config({ model: "ollama:my-embedder" });
    expect(
      createEmbedder(unknown, { keys: {}, registry: buildRegistry(unknown) })
    ).toMatchObject({ error: { type: "unavailable" }, ok: false });
    const sized = config({ dimensions: 512, model: "ollama:my-embedder" });
    const custom = createEmbedder(sized, {
      keys: {},
      registry: buildRegistry(sized),
    });
    expect(custom.ok && custom.value.dimensions).toBe(512);
  });
});
