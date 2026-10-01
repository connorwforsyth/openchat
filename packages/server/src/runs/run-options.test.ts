import { textStream } from "@workspace/ai/testing/mock-models";
import { appConfigSchema } from "@workspace/config/schema";
import type { Conversation } from "@workspace/contract/schemas/conversations";
import type {
  CreateRunOutput,
  Run,
  RunOptions,
} from "@workspace/contract/schemas/runs";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, describe, expect, it } from "vitest";

import { createHarness, type Harness } from "../testing/harness";

// A run's thinking level and fast mode (105): stored on the run, returned
// with it, and handed to the model's provider where the model takes them.

const { providers } = appConfigSchema.parse({
  providers: {
    anthropic: { apiKey: "test-key-not-real" },
    openai: { apiKey: "test-key-not-real" },
  },
});

let h: Harness | undefined;

afterEach(() => h?.close());

const json = async <T>(response: Response, status = 200): Promise<T> => {
  if (response.status !== status) {
    throw new Error(`expected ${status}, got ${response.status}`);
  }
  return (await response.json()) as T;
};

/** Runs one turn on `model` with `options`; returns the stored run. */
const runWith = async (
  harness: Harness,
  model: string,
  options?: Partial<RunOptions>
): Promise<Run> => {
  const chat = await json<Conversation>(
    await harness.request("/api/conversations", { json: {}, method: "POST" }),
    201
  );
  const created = await json<CreateRunOutput>(
    await harness.request("/api/runs", {
      json: {
        conversationId: chat.id,
        input: {
          parentId: null,
          parts: [{ text: "hi", type: "text" }],
          type: "message",
        },
        ...(options ? { options } : {}),
        target: { model, type: "model" },
      },
      method: "POST",
    }),
    202
  );
  await harness.services.executor.idle();
  return json<Run>(await harness.request(`/api/runs/${created.runId}`));
};

const mock = () => new MockLanguageModelV4({ doStream: textStream("ok") });

describe("a run's reasoning and fast options", () => {
  it("are stored and returned with the run", async () => {
    const gpt = mock();
    h = await createHarness({
      models: { "openai:gpt-5.2": gpt },
      providers,
      realTurns: true,
    });
    const run = await runWith(h, "openai:gpt-5.2", {
      fast: true,
      reasoning: "low",
    });
    expect(run.state.status).toBe("succeeded");
    expect(run.options).toEqual({
      fast: true,
      reasoning: "low",
      sandbox: "auto",
      webSearch: "auto",
    });
    // Without them, the defaults.
    const plain = await runWith(h, "openai:gpt-5.2");
    expect(plain.options).toEqual({ sandbox: "auto", webSearch: "auto" });
  });

  it("reach an OpenAI model as its reasoning setting and priority tier", async () => {
    const gpt = mock();
    h = await createHarness({
      models: { "openai:gpt-5.2": gpt },
      providers,
      realTurns: true,
    });
    await runWith(h, "openai:gpt-5.2", { fast: true, reasoning: "off" });
    const [call] = gpt.doStreamCalls;
    expect(call?.reasoning).toBe("none");
    expect(call?.providerOptions).toMatchObject({
      openai: { serviceTier: "priority" },
    });
  });

  it("reach an Anthropic model as its reasoning setting and fast speed", async () => {
    const opus = mock();
    h = await createHarness({
      models: { "anthropic:claude-opus-4-6": opus },
      providers,
      realTurns: true,
    });
    await runWith(h, "anthropic:claude-opus-4-6", {
      fast: true,
      reasoning: "high",
    });
    const [call] = opus.doStreamCalls;
    expect(call?.reasoning).toBe("high");
    expect(call?.providerOptions).toMatchObject({
      anthropic: { speed: "fast" },
    });
  });

  it("are dropped where the model doesn't take them", async () => {
    const haiku = mock();
    h = await createHarness({
      models: { "anthropic:claude-haiku-4-5": haiku },
      providers,
      realTurns: true,
    });
    // Haiku 4.5 takes a budget, not xhigh, and has no fast tier.
    const run = await runWith(h, "anthropic:claude-haiku-4-5", {
      fast: true,
      reasoning: "xhigh",
    });
    expect(run.state.status).toBe("succeeded");
    const [call] = haiku.doStreamCalls;
    expect(call?.reasoning).toBeUndefined();
    expect(call?.providerOptions?.anthropic).toBeUndefined();
  });
});
