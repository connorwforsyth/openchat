import { createMemoryKeyStore } from "@workspace/ai/keys/key-store.memory";
import { buildRegistry } from "@workspace/ai/providers/registry";
import { appConfigSchema } from "@workspace/config/schema";
import type { UserId } from "@workspace/contract/schemas/common";
import type { Db } from "@workspace/db/client";
import { newId } from "@workspace/shared/ids";
import { generateText, type ModelMessage } from "ai";
import { describe, expect, it } from "vitest";

import { createModelLoader } from "./turn";

// An image a tool returned, as the run's model reaches a local Ollama: the
// loader asks Ollama's tags which models see, and the request that leaves
// carries the image where Ollama reads it (a user message; its tool
// messages are text) or, for a model that can't see, a note naming one
// that can. The fetch is canned: nothing reaches a server.

const userId = newId("user") as UserId;
const caller = { context: { type: "personal" as const }, userId };
const state = { facts: {}, history: [], input: "hi" };

const config = appConfigSchema.parse({
  providers: {
    ollama: { baseURL: "http://ollama.test/v1", type: "openai-compatible" },
  },
});

// Trimmed from Ollama 0.40's `/api/tags`.
const tags = {
  models: [
    { capabilities: ["completion", "tools"], name: "qwen2.5:3b" },
    { capabilities: ["completion", "vision"], name: "qwen2.5vl:3b" },
  ],
};

const IMAGE =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC";

const messages: ModelMessage[] = [
  { content: "What's in red.png?", role: "user" },
  {
    content: [
      {
        input: { path: "red.png" },
        toolCallId: "call-1",
        toolName: "read",
        type: "tool-call",
      },
    ],
    role: "assistant",
  },
  {
    content: [
      {
        output: {
          type: "content",
          value: [
            {
              text: "red.png is an image (image/png, 70 bytes).",
              type: "text",
            },
            {
              data: { data: IMAGE, type: "data" },
              mediaType: "image/png",
              type: "file",
            },
          ],
        },
        toolCallId: "call-1",
        toolName: "read",
        type: "tool-result",
      },
    ],
    role: "tool",
  },
];

interface Sent {
  readonly content: unknown;
  readonly role: string;
}

/** Answers `selector` from `messages` and returns the messages Ollama was sent. */
const sentTo = async (selector: string): Promise<readonly Sent[]> => {
  const bodies: { messages: Sent[] }[] = [];
  const fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/api/tags")) {
      return Promise.resolve(Response.json(tags));
    }
    bodies.push(JSON.parse(String(init?.body)));
    return Promise.resolve(
      Response.json({
        choices: [
          {
            finish_reason: "stop",
            index: 0,
            message: { content: "A red square.", role: "assistant" },
          },
        ],
        created: 0,
        id: "chatcmpl-1",
        model: selector,
        object: "chat.completion",
      })
    );
  }) as typeof globalThis.fetch;
  const registry = buildRegistry(config, { fetch });
  const loaded = await createModelLoader({
    catalog: registry.catalog,
    config,
    db: {} as Db,
    keyStore: createMemoryKeyStore([]),
    registry,
  })(caller, selector, { state });
  if (!loaded.ok) {
    throw new Error(`couldn't load ${selector}`);
  }
  await generateText({ messages, model: loaded.value.model });
  return bodies[0]?.messages ?? [];
};

describe("tool images on a local Ollama", () => {
  it("sends a vision model the image in a user message after the tool's", async () => {
    const sent = await sentTo("ollama:qwen2.5vl:3b");
    expect(sent.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "user",
    ]);
    expect(JSON.stringify(sent[2])).not.toContain(IMAGE);
    expect(sent[3]?.content).toContainEqual({
      image_url: { url: `data:image/png;base64,${IMAGE}` },
      type: "image_url",
    });
  });

  it("tells a model that can't see, and names one that can", async () => {
    const sent = await sentTo("ollama:qwen2.5:3b");
    expect(sent.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "tool",
    ]);
    expect(JSON.stringify(sent)).not.toContain(IMAGE);
    expect(sent[2]?.content).toContain("this model can't see images");
    expect(sent[2]?.content).toContain("such as ollama:qwen2.5vl:3b");
  });
});
