import type { LlmProxyRequest } from "@workspace/contract/schemas/llm";
import { ok } from "@workspace/shared/result";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";

import { createMemoryProviderRegistry } from "../ports/provider-registry.memory";
import { generated, streamOf, textStream, usage } from "../testing/mock-models";
import { llmProxyErrorBody } from "./errors";
import {
  handleLlmProxy,
  type LlmProxyDeps,
  type LlmUsageEvent,
  llmProxyResponse,
} from "./handle";

const body = (overrides: Partial<LlmProxyRequest> = {}): LlmProxyRequest => ({
  context: { type: "personal" },
  model: "fast",
  prompt: [{ content: [{ text: "hi", type: "text" }], role: "user" }],
  stream: false,
  ...overrides,
});

const setup = ({
  cheap = new MockLanguageModelV4({
    doGenerate: generated([{ text: "hello", type: "text" }]),
  }),
  strong = new MockLanguageModelV4({
    doGenerate: generated([{ text: "HELLO", type: "text" }]),
  }),
  withAuto = true,
} = {}) => {
  const usageEvents: LlmUsageEvent[] = [];
  const deps: LlmProxyDeps = {
    recordUsage: (event) => usageEvents.push(event),
    registry: createMemoryProviderRegistry({
      aliases: { fast: "local:small", strong: "hosted:big" },
      keyless: ["local"],
      languageModels: { "hosted:big": strong, "local:small": cheap },
    }),
    resolveKeys: () => Promise.resolve(ok({})),
    routeAuto: withAuto
      ? () =>
          Promise.resolve(
            ok({
              probability: 0.2,
              routedBy: "decider" as const,
              selector: "fast",
            })
          )
      : undefined,
  };
  return { cheap, deps, strong, usageEvents };
};

const DATA_PREFIX = /^data: /;

const sseEvents = async (response: Response) =>
  (await response.text())
    .split("\n\n")
    .filter(Boolean)
    .map((line) => line.replace(DATA_PREFIX, ""));

describe("handleLlmProxy", () => {
  it("answers JSON with the resolved model and records usage", async () => {
    const { cheap, deps, usageEvents } = setup();
    const result = await handleLlmProxy(body({ temperature: 0.1 }), deps);
    expect(result).toMatchObject({
      ok: true,
      value: {
        body: {
          content: [{ text: "hello", type: "text" }],
          finishReason: { unified: "stop" },
          resolvedModel: "local:small",
          usage: { inputTokens: { total: 10 } },
        },
        kind: "json",
      },
    });
    expect(cheap.doGenerateCalls[0]?.temperature).toBe(0.1);
    expect(usageEvents).toEqual([
      {
        context: { type: "personal" },
        outcome: "completed",
        resolvedModel: "local:small",
        source: null,
        usage: expect.objectContaining({
          outputTokens: expect.objectContaining({ total: 5 }),
        }),
      },
    ]);
    const response = llmProxyResponse(result);
    expect(response.headers.get("x-resolved-model")).toBe("local:small");
  });

  it("streams provider parts as SSE ending [DONE]", async () => {
    const cheap = new MockLanguageModelV4({
      doStream: textStream("Hi", usage(3, 2)),
    });
    const { deps, usageEvents } = setup({ cheap });
    const response = llmProxyResponse(
      await handleLlmProxy(body({ stream: true }), deps)
    );
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("x-accel-buffering")).toBe("no");
    const events = await sseEvents(response);
    expect(events.at(-1)).toBe("[DONE]");
    expect(events.slice(0, -1).map((e) => JSON.parse(e).type)).toEqual([
      "stream-start",
      "text-start",
      "text-delta",
      "text-end",
      "finish",
    ]);
    expect(usageEvents[0]).toMatchObject({
      outcome: "completed",
      usage: { inputTokens: { total: 3 } },
    });
  });

  it("ends a failing stream with a safe error part", async () => {
    const cheap = new MockLanguageModelV4({
      doStream: streamOf([
        { id: "t", type: "text-start" },
        {
          error: new Error("upstream body with sk-live-secret"),
          type: "error",
        },
      ]),
    });
    const { deps, usageEvents } = setup({ cheap });
    const events = await sseEvents(
      llmProxyResponse(await handleLlmProxy(body({ stream: true }), deps))
    );
    expect(events.at(-1)).toBe("[DONE]");
    expect(JSON.parse(events.at(-2) ?? "{}")).toEqual({
      error: {
        code: "internal",
        message: expect.any(String),
        retryable: false,
      },
      type: "error",
    });
    expect(events.join()).not.toContain("sk-live");
    expect(usageEvents[0]?.outcome).toBe("failed");
  });

  it("stops the provider and records usage when the client goes away", async () => {
    let upstreamCancelled = false;
    const cheap = new MockLanguageModelV4({
      doStream: {
        stream: new ReadableStream({
          cancel: () => {
            upstreamCancelled = true;
          },
          start: (controller) =>
            controller.enqueue({ id: "t", type: "text-start" }),
        }),
      },
    });
    const { deps, usageEvents } = setup({ cheap });
    const result = await handleLlmProxy(body({ stream: true }), deps);
    if (!(result.ok && result.value.kind === "stream")) {
      throw new Error("expected a stream");
    }
    const reader = result.value.body.getReader();
    await reader.read();
    await reader.cancel();
    expect(upstreamCancelled).toBe(true);
    expect(usageEvents).toMatchObject([{ outcome: "cancelled", usage: null }]);
  });

  it("routes auto through the Decider", async () => {
    const { deps } = setup();
    const result = await handleLlmProxy(body({ model: "auto" }), deps);
    expect(result.ok && result.value.resolvedModel).toBe("local:small");
    const off = await handleLlmProxy(
      body({ model: "auto" }),
      setup({ withAuto: false }).deps
    );
    expect(off).toMatchObject({ error: { code: "VALIDATION" }, ok: false });
  });

  it.each([
    ["an unknown model", { model: "mistral:large" }],
    [
      "a file by URL",
      {
        prompt: [
          {
            content: [
              {
                data: { type: "url", url: "http://169.254.169.254/latest" },
                mediaType: "text/plain",
                type: "file",
              },
            ],
            role: "user" as const,
          },
        ],
      },
    ],
    [
      "a URL string as file data",
      {
        prompt: [
          {
            content: [
              {
                data: "file:///etc/passwd",
                mediaType: "text/plain",
                type: "file",
              },
            ],
            role: "user" as const,
          },
        ],
      },
    ],
    [
      "a file by URL inside a tool result",
      {
        prompt: [
          {
            content: [
              {
                output: {
                  type: "content",
                  value: [
                    {
                      data: { type: "url", url: "https://internal/x" },
                      mediaType: "image/png",
                      type: "file",
                    },
                  ],
                },
                toolCallId: "c1",
                toolName: "read",
                type: "tool-result",
              },
            ],
            role: "tool" as const,
          },
        ],
      },
    ],
    [
      "a provider file reference",
      {
        prompt: [
          {
            content: [
              {
                data: { reference: { openai: "file-123" }, type: "reference" },
                mediaType: "application/pdf",
                type: "file",
              },
            ],
            role: "user" as const,
          },
        ],
      },
    ],
    [
      "a malformed message",
      { prompt: [{ content: "not parts", role: "user" as const }] },
    ],
  ])("refuses %s as VALIDATION", async (_name, overrides) => {
    const { cheap, deps } = setup();
    const result = await handleLlmProxy(body(overrides), deps);
    expect(result).toMatchObject({ error: { code: "VALIDATION" }, ok: false });
    expect(cheap.doGenerateCalls).toHaveLength(0);
  });

  it("accepts base64 and inline text files", async () => {
    const { cheap, deps } = setup();
    const result = await handleLlmProxy(
      body({
        prompt: [
          {
            content: [
              {
                data: { data: "aGVsbG8=", type: "data" },
                mediaType: "text/plain",
                type: "file",
              },
              {
                data: { text: "notes", type: "text" },
                mediaType: "text/plain",
                type: "file",
              },
            ],
            role: "user",
          },
        ],
      }),
      deps
    );
    expect(result.ok).toBe(true);
    expect(cheap.doGenerateCalls).toHaveLength(1);
  });

  it("rejects provider-executed tools and bodies that don't parse", async () => {
    const { deps } = setup();
    const withProviderTool = await handleLlmProxy(
      {
        ...body(),
        tools: [
          {
            args: {},
            id: "openai.web_search",
            name: "web_search",
            type: "provider",
          },
        ],
      },
      deps
    );
    expect(withProviderTool).toMatchObject({
      error: { code: "BAD_REQUEST" },
      ok: false,
    });
    expect(await handleLlmProxy("nope", deps)).toMatchObject({
      error: { code: "BAD_REQUEST" },
    });
  });

  it("answers PROVIDER_UNAVAILABLE without a key for the context", async () => {
    const { deps } = setup();
    const result = await handleLlmProxy(body({ model: "strong" }), deps);
    expect(result).toEqual({
      error: { code: "PROVIDER_UNAVAILABLE", data: { provider: "hosted" } },
      ok: false,
    });
    if (!result.ok) {
      expect(llmProxyErrorBody(result.error)).toMatchObject({
        body: { code: "PROVIDER_UNAVAILABLE", defined: true, status: 503 },
        status: 503,
      });
    }
  });

  it("drops call options that reach other people's stored data", async () => {
    const { deps, strong } = setup();
    const keyed: LlmProxyDeps = {
      ...deps,
      resolveKeys: () =>
        Promise.resolve(
          ok({
            hosted: {
              apiKey: "test-key",
              provider: "hosted",
              source: { type: "instance" },
            },
          })
        ),
    };
    await handleLlmProxy(
      body({
        model: "strong",
        providerOptions: {
          openai: {
            previousResponseId: "resp_someone_else",
            reasoningSummary: "auto",
          },
        },
      }),
      keyed
    );
    expect(strong.doGenerateCalls[0]?.providerOptions).toEqual({
      openai: { reasoningSummary: "auto" },
    });
  });
});
