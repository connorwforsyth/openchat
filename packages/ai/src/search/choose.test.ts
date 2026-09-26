import { type AppConfigInput, appConfigSchema } from "@workspace/config/schema";
import type { WebSearchResult } from "@workspace/contract/schemas/search";
import { err } from "@workspace/shared/result";
import { describe, expect, it } from "vitest";

import { createMemorySearchBackend } from "../ports/search-backend.memory";
import { toolSources } from "../rag/sources";
import { chooseWebSearch, supportsNativeWebSearch } from "./choose";
import type { WebSearchToolOutput } from "./web-search-tool";

const providers = {
  anthropic: {},
  local: { baseURL: "http://localhost:11434/v1", type: "openai-compatible" },
  openai: {},
} as const;

const config = (input: AppConfigInput = {}) =>
  appConfigSchema.parse({ providers, ...input });

const doc: WebSearchResult = {
  publishedAt: null,
  snippet: "Postgres 18 adds asynchronous I/O.",
  title: "Postgres 18 released",
  url: "https://example.org/pg18",
};
const backend = createMemorySearchBackend([doc]);

describe("supportsNativeWebSearch", () => {
  it.each([
    ["anthropic", "claude-sonnet-4-5", true],
    ["anthropic", "claude-3-5-haiku-latest", true],
    ["anthropic", "claude-3-haiku-20240307", false],
    ["openai", "gpt-5-mini", true],
    ["openai", "gpt-4.1-nano", false],
    ["openai", "gpt-3.5-turbo", false],
    ["google", "gemini-2.5-flash", true],
    ["google", "gemini-1.5-pro", false],
    ["openai-compatible", "llama3", false],
    ["bedrock", "anthropic.claude-sonnet-4", false],
  ] as const)("%s %s → %s", (provider, model, expected) => {
    expect(supportsNativeWebSearch(provider, model)).toBe(expected);
  });
});

describe("chooseWebSearch", () => {
  it("uses the provider's own search when the model has it and it's allowed", () => {
    const choice = chooseWebSearch({
      backend,
      config: config(),
      model: "anthropic:claude-sonnet-4-5",
    });
    expect(choice.kind).toBe("native");
    expect(choice.kind === "native" && choice.tool.type).toBe("provider");
    const openai = chooseWebSearch({
      backend: null,
      config: config(),
      model: "openai:gpt-5",
    });
    expect(openai.kind === "native" && openai.provider).toBe("openai");
  });

  it("falls back to our tool when native search is off, not allowed or unsupported", () => {
    for (const choice of [
      chooseWebSearch({
        backend,
        config: config({ search: { native: false } }),
        model: "anthropic:claude-sonnet-4-5",
      }),
      chooseWebSearch({
        backend,
        config: config(),
        model: "anthropic:claude-sonnet-4-5",
        nativeAllowed: false,
      }),
      chooseWebSearch({ backend, config: config(), model: "local:llama3" }),
    ]) {
      expect(choice).toMatchObject({ backend: "memory", kind: "tool" });
    }
  });

  it("offers nothing without a backend or with the feature off", () => {
    expect(
      chooseWebSearch({
        backend: null,
        config: config(),
        model: "local:llama3",
      })
    ).toEqual({ kind: "none", reason: "no_backend" });
    expect(
      chooseWebSearch({
        backend,
        config: config({ features: { webSearch: false } }),
        model: "anthropic:claude-sonnet-4-5",
      })
    ).toEqual({ kind: "none", reason: "disabled" });
  });
});

describe("web_search tool", () => {
  const call = async (choice: ReturnType<typeof chooseWebSearch>) =>
    (await (choice.kind === "tool"
      ? choice.tool.execute?.(
          { limit: 3, query: "postgres 18" },
          { context: {}, messages: [], toolCallId: "call_9" }
        )
      : undefined)) as WebSearchToolOutput;

  it("returns results with url citations", async () => {
    const output = await call(
      chooseWebSearch({ backend, config: config(), model: "local:llama3" })
    );
    expect(output).toMatchObject({ results: [doc], status: "ok" });
    expect(toolSources(output)).toEqual([
      {
        id: "call_9-1",
        source: { kind: "url", title: doc.title, url: doc.url },
        type: "source",
      },
    ]);
    expect(backend.queries).toContain("postgres 18");
  });

  it("reports a failing backend to the model instead of failing the run", async () => {
    const output = await call(
      chooseWebSearch({
        backend: {
          id: "down",
          search: () =>
            Promise.resolve(
              err({ message: "down", type: "unavailable" as const })
            ),
        },
        config: config(),
        model: "local:llama3",
      })
    );
    expect(output).toEqual({
      message: "Web search is unavailable right now; answer without it.",
      status: "unavailable",
    });
  });
});
