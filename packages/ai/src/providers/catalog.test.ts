import {
  type ProviderConfig,
  providerConfigSchema,
} from "@workspace/config/schema";
import { describe, expect, it } from "vitest";

import type { ProviderCredentials } from "../ports/provider-registry";
import {
  catalogKindOf,
  catalogRequest,
  describeCatalogError,
  fetchCatalog,
  parseCatalog,
} from "./catalog";

// Every catalog is a canned response from a fake `fetch`: no test here
// reaches a provider.

const API_KEY = "test-key-not-real";

const key = (provider: string, baseURL?: string): ProviderCredentials => ({
  apiKey: API_KEY,
  baseURL,
  provider,
  source: { type: "instance" },
});

const configOf = (input: Record<string, unknown>): ProviderConfig =>
  providerConfigSchema.parse(input);

interface Seen {
  readonly headers: Record<string, string>;
  readonly url: string;
}

/** A `fetch` answering `body` with `status`, recording what it was asked. */
const fakeFetch = (body: unknown, status = 200) => {
  const seen: Seen[] = [];
  const fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push({
      headers: { ...(init?.headers as Record<string, string>) },
      url: String(input),
    });
    return Promise.resolve(
      new Response(typeof body === "string" ? body : JSON.stringify(body), {
        headers: { "content-type": "application/json" },
        status,
      })
    );
  };
  return { fetch: fetch as typeof globalThis.fetch, seen };
};

const refuseNetwork = (() => {
  throw new Error("unexpected network call");
}) as typeof globalThis.fetch;

describe("catalogKindOf", () => {
  it("reads Ollama's tags by id or option, OpenAI's /models otherwise", () => {
    const local = configOf({
      baseURL: "http://localhost:11434/v1",
      type: "openai-compatible",
    });
    expect(catalogKindOf("ollama", local)).toBe("ollama");
    expect(catalogKindOf("lan", local)).toBe("openai");
    expect(
      catalogKindOf("lan", { ...local, options: { catalog: "ollama" } })
    ).toBe("ollama");
    expect(catalogKindOf("anthropic", configOf({ type: "anthropic" }))).toBe(
      "anthropic"
    );
    expect(
      catalogKindOf(
        "bedrock",
        configOf({ options: { region: "us-east-1" }, type: "bedrock" })
      )
    ).toBeNull();
  });
});

describe("fetchCatalog", () => {
  it("lists an openai-compatible gateway with its metadata, chat and image models only", async () => {
    const { fetch, seen } = fakeFetch({
      data: [
        {
          context_window: 200_000,
          description: "Fast and cheap.",
          id: "anthropic/claude-haiku-4.5",
          name: "Claude Haiku 4.5",
          pricing: { input: "0.000001" },
          type: "language",
        },
        { id: "openai/text-embedding-3-small", type: "embedding" },
        { id: "openai/gpt-image-1", type: "image" },
        { context_length: 131_072, id: "meta/llama-4" },
        { id: "has space" },
      ],
      object: "list",
    });
    const gateway = configOf({
      baseURL: "https://gateway.example/v1/",
      headers: { "x-team": "t1" },
      options: { keyless: "false" },
      type: "openai-compatible",
    });
    const result = await fetchCatalog("gateway", gateway, key("gateway"), {
      fetch,
    });
    expect(result).toEqual({
      ok: true,
      value: [
        {
          contextWindow: 200_000,
          description: "Fast and cheap.",
          id: "anthropic/claude-haiku-4.5",
          name: "Claude Haiku 4.5",
          pricing: { input: 1_000_000 },
        },
        // Kept apart for `generate_image` (138), never the chat picker.
        {
          contextWindow: null,
          description: null,
          id: "openai/gpt-image-1",
          kind: "image",
          name: null,
        },
        {
          contextWindow: 131_072,
          description: null,
          id: "meta/llama-4",
          name: null,
        },
      ],
    });
    expect(seen).toEqual([
      {
        headers: { authorization: `Bearer ${API_KEY}`, "x-team": "t1" },
        url: "https://gateway.example/v1/models",
      },
    ]);
  });

  it("reads a keyless Ollama's tags, sending no key", async () => {
    const { fetch, seen } = fakeFetch({
      models: [
        {
          details: { family: "llama" },
          model: "llama3.2:latest",
          name: "llama3.2:latest",
        },
        { name: "qwen3:8b" },
      ],
    });
    const ollama = configOf({
      baseURL: "http://localhost:11434/v1",
      type: "openai-compatible",
    });
    const result = await fetchCatalog("ollama", ollama, undefined, { fetch });
    expect(result.ok && result.value.map((model) => model.id)).toEqual([
      "llama3.2:latest",
      "qwen3:8b",
    ]);
    expect(seen).toEqual([
      { headers: {}, url: "http://localhost:11434/api/tags" },
    ]);
  });

  it("reads which of Ollama's models see from their capabilities", () => {
    expect(
      parseCatalog("ollama", {
        models: [
          { capabilities: ["completion", "tools"], name: "qwen2.5:3b" },
          { capabilities: ["completion", "vision"], name: "qwen2.5vl:3b" },
          { name: "older:latest" },
        ],
      })?.map(({ id, traits }) => ({ id, traits }))
    ).toEqual([
      { id: "qwen2.5:3b", traits: { vision: false } },
      { id: "qwen2.5vl:3b", traits: { vision: true } },
      { id: "older:latest", traits: undefined },
    ]);
  });

  it("lists Anthropic's models with its headers and display names", async () => {
    const { fetch, seen } = fakeFetch({
      data: [
        {
          created_at: "2026-01-01T00:00:00Z",
          display_name: "Claude Opus 5.5",
          id: "claude-opus-5-5",
          type: "model",
        },
      ],
      has_more: false,
    });
    const result = await fetchCatalog(
      "anthropic",
      configOf({ type: "anthropic" }),
      key("anthropic"),
      { fetch }
    );
    expect(result).toEqual({
      ok: true,
      value: [
        {
          contextWindow: null,
          description: null,
          id: "claude-opus-5-5",
          name: "Claude Opus 5.5",
        },
      ],
    });
    expect(seen).toEqual([
      {
        headers: { "anthropic-version": "2023-06-01", "x-api-key": API_KEY },
        url: "https://api.anthropic.com/v1/models?limit=1000",
      },
    ]);
  });

  it("lists OpenAI's models at its default URL", async () => {
    const { fetch, seen } = fakeFetch({
      data: [
        { created: 1, id: "gpt-5-mini", object: "model", owned_by: "openai" },
      ],
    });
    const result = await fetchCatalog(
      "openai",
      configOf({ type: "openai" }),
      key("openai"),
      { fetch }
    );
    expect(result.ok && result.value.map((model) => model.id)).toEqual([
      "gpt-5-mini",
    ]);
    expect(seen[0]?.url).toBe("https://api.openai.com/v1/models");
  });

  it("lists Google's generate models with the key in a header, not the URL", async () => {
    const { fetch, seen } = fakeFetch({
      models: [
        {
          description: "Thinks hard.",
          displayName: "Gemini 2.5 Pro",
          inputTokenLimit: 1_048_576,
          name: "models/gemini-2.5-pro",
          supportedGenerationMethods: ["generateContent", "countTokens"],
        },
        {
          name: "models/text-embedding-004",
          supportedGenerationMethods: ["embedContent"],
        },
      ],
    });
    const result = await fetchCatalog(
      "google",
      configOf({ type: "google" }),
      key("google"),
      { fetch }
    );
    expect(result).toEqual({
      ok: true,
      value: [
        {
          contextWindow: 1_048_576,
          description: "Thinks hard.",
          id: "gemini-2.5-pro",
          name: "Gemini 2.5 Pro",
        },
      ],
    });
    expect(seen[0]?.url).not.toContain(API_KEY);
    expect(seen[0]?.headers["x-goog-api-key"]).toBe(API_KEY);
  });

  it("uses the key's own baseURL when it has one", () => {
    const request = catalogRequest(
      "openai",
      configOf({ type: "openai" }),
      key("openai", "https://proxy.example/v1")
    );
    expect(request.ok && request.value.url).toBe(
      "https://proxy.example/v1/models"
    );
  });

  it("never sends another provider's key, and needs one when hosted", async () => {
    const result = await fetchCatalog(
      "anthropic",
      configOf({ type: "anthropic" }),
      key("openai"),
      { fetch: refuseNetwork }
    );
    expect(result).toEqual({ error: { type: "missing_key" }, ok: false });
  });

  it("has no catalog for Azure or Bedrock", async () => {
    const result = await fetchCatalog(
      "azure",
      configOf({ options: { resourceName: "r" }, type: "azure" }),
      key("azure"),
      { fetch: refuseNetwork }
    );
    expect(result).toEqual({ error: { type: "unsupported" }, ok: false });
  });

  it.each([
    [
      "an HTTP error",
      fakeFetch({ error: "nope" }, 401).fetch,
      { status: 401, type: "http" },
    ],
    [
      "a body that isn't JSON",
      fakeFetch("<html>", 200).fetch,
      { type: "invalid_response" },
    ],
    [
      "an unexpected shape",
      fakeFetch({ models: "x" }).fetch,
      { type: "invalid_response" },
    ],
    [
      "a network failure",
      (() =>
        Promise.reject(
          new TypeError("fetch failed")
        )) as typeof globalThis.fetch,
      { type: "unreachable" },
    ],
  ])("reports %s without the key or URL", async (_, fetch, error) => {
    const result = await fetchCatalog(
      "openai",
      configOf({ type: "openai" }),
      key("openai"),
      { fetch }
    );
    expect(result).toEqual({ error, ok: false });
    const text = JSON.stringify(result);
    expect(text).not.toContain(API_KEY);
    expect(text).not.toContain("api.openai.com");
    expect(result.ok || describeCatalogError(result.error)).not.toContain(
      API_KEY
    );
  });

  it("gives up after its timeout", async () => {
    const hang = ((_: RequestInfo | URL, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError"))
        );
      })) as typeof globalThis.fetch;
    const result = await fetchCatalog(
      "openai",
      configOf({ type: "openai" }),
      key("openai"),
      { fetch: hang, timeoutMs: 20 }
    );
    expect(result).toEqual({ error: { type: "timeout" }, ok: false });
  });
});
